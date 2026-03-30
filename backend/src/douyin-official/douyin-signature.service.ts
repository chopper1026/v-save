import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { randomInt } from 'node:crypto';
import { access } from 'node:fs/promises';
import * as path from 'node:path';

const PYTHON_WORKER_BRIDGE = [
  'import importlib.util',
  'import json',
  'import sys',
  'from urllib.parse import quote',
  '',
  'helper_path = sys.argv[1]',
  'spec = importlib.util.spec_from_file_location("douyin_abogus", helper_path)',
  'if spec is None or spec.loader is None:',
  '    raise RuntimeError(f"Unable to load helper: {helper_path}")',
  'module = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(module)',
  '',
  'for raw_line in sys.stdin:',
  '    line = raw_line.strip()',
  '    if not line:',
  '        continue',
  '    request_id = None',
  '    try:',
  '        request = json.loads(line)',
  '        request_id = request.get("id")',
  '        payload = request.get("payload")',
  '        a_bogus = quote(module.ABogus().get_value(payload), safe="")',
  '        print(json.dumps({"id": request_id, "a_bogus": a_bogus}, ensure_ascii=False), flush=True)',
  '    except Exception as exc:',
  '        print(json.dumps({"id": request_id, "error": str(exc)}, ensure_ascii=False), flush=True)',
].join('\n');

interface PendingWorkerRequest {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

@Injectable()
export class DouyinSignatureService implements OnModuleDestroy {
  private readonly logger = new Logger(DouyinSignatureService.name);
  private readonly pythonCommand =
    process.env.DOUYIN_ABOGUS_PYTHON?.trim() || 'python3';
  private readonly helperRequestTimeoutMs = this.readPositiveIntEnv(
    'DOUYIN_ABOGUS_TIMEOUT_MS',
    10_000,
  );
  private readonly helperPath =
    process.env.DOUYIN_ABOGUS_HELPER_PATH?.trim() ||
    path.resolve(process.cwd(), 'tools/douyin/abogus.py');

  private worker: ChildProcessWithoutNullStreams | null = null;
  private workerStartPromise: Promise<ChildProcessWithoutNullStreams> | null =
    null;
  private workerStdoutBuffer = '';
  private workerStderrBuffer = '';
  private helperVerified = false;
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<number, PendingWorkerRequest>();
  private readonly closingWorkers =
    new Set<ChildProcessWithoutNullStreams>();

  async generateABogus(
    params: Record<string, string | number | boolean>,
  ): Promise<string> {
    await this.assertHelperExists();
    const worker = await this.ensureWorker();
    return this.executeWorkerRequest(worker, params);
  }

  generateMsToken(): string {
    const alphabet =
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let token = '';
    for (let index = 0; index < 126; index += 1) {
      token += alphabet[randomInt(0, alphabet.length)];
    }
    return `${token}==`;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopWorker(new Error('a_bogus worker is shutting down'));
  }

  private async ensureWorker(): Promise<ChildProcessWithoutNullStreams> {
    if (this.worker && !this.worker.killed && this.worker.exitCode === null) {
      return this.worker;
    }

    if (this.workerStartPromise) {
      return this.workerStartPromise;
    }

    this.workerStartPromise = this.startWorker();
    try {
      return await this.workerStartPromise;
    } finally {
      this.workerStartPromise = null;
    }
  }

  private async startWorker(): Promise<ChildProcessWithoutNullStreams> {
    const child = spawn(
      this.pythonCommand,
      ['-u', '-c', PYTHON_WORKER_BRIDGE, this.helperPath],
      {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    this.worker = child;
    this.workerStdoutBuffer = '';
    this.workerStderrBuffer = '';

    child.stdout.on('data', (chunk) => {
      this.handleWorkerStdout(child, String(chunk || ''));
    });

    child.stderr.on('data', (chunk) => {
      this.workerStderrBuffer = `${this.workerStderrBuffer}${String(
        chunk || '',
      )}`.slice(-4000);
    });

    child.on('error', (error) => {
      this.failWorker(
        child,
        new Error(`a_bogus worker 启动失败: ${error.message}`),
      );
    });

    child.on('close', (code, signal) => {
      this.handleWorkerClose(child, code, signal);
    });

    await new Promise<void>((resolve, reject) => {
      const handleSpawn = () => {
        cleanup();
        resolve();
      };
      const handleError = (error: Error) => {
        cleanup();
        reject(new Error(`a_bogus worker 启动失败: ${error.message}`));
      };
      const cleanup = () => {
        child.off('spawn', handleSpawn);
        child.off('error', handleError);
      };

      child.once('spawn', handleSpawn);
      child.once('error', handleError);
    });

    return child;
  }

  private async executeWorkerRequest(
    worker: ChildProcessWithoutNullStreams,
    params: Record<string, string | number | boolean>,
  ): Promise<string> {
    const requestId = this.nextRequestId++;

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.failWorker(
          worker,
          new Error(
            `a_bogus worker 请求超时 (${this.helperRequestTimeoutMs}ms)`,
          ),
        );
      }, this.helperRequestTimeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout,
      });

      const message = `${JSON.stringify({
        id: requestId,
        payload: params,
      })}\n`;

      worker.stdin.write(message, (error) => {
        if (error) {
          this.failWorker(
            worker,
            new Error(`a_bogus worker 写入失败: ${error.message}`),
          );
        }
      });
    });
  }

  private handleWorkerStdout(
    worker: ChildProcessWithoutNullStreams,
    chunk: string,
  ): void {
    if (worker !== this.worker) {
      return;
    }

    this.workerStdoutBuffer += chunk;

    let newlineIndex = this.workerStdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.workerStdoutBuffer.slice(0, newlineIndex).trim();
      this.workerStdoutBuffer = this.workerStdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleWorkerResponseLine(worker, line);
      }
      newlineIndex = this.workerStdoutBuffer.indexOf('\n');
    }
  }

  private handleWorkerResponseLine(
    worker: ChildProcessWithoutNullStreams,
    line: string,
  ): void {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch (error: any) {
      this.failWorker(
        worker,
        new Error(
          `a_bogus worker 返回了非 JSON 内容: ${error?.message || 'unknown'}`,
        ),
      );
      return;
    }

    const requestId = Number(parsed?.id);
    if (!Number.isInteger(requestId)) {
      this.failWorker(worker, new Error('a_bogus worker 返回了无效请求编号'));
      return;
    }

    const pendingRequest = this.pendingRequests.get(requestId);
    if (!pendingRequest) {
      return;
    }

    this.pendingRequests.delete(requestId);
    clearTimeout(pendingRequest.timeout);

    if (parsed?.error) {
      pendingRequest.reject(
        new Error(`a_bogus worker 处理失败: ${String(parsed.error)}`),
      );
      return;
    }

    const value = String(parsed?.a_bogus || '').trim();
    if (!value) {
      pendingRequest.reject(new Error('a_bogus worker 未返回有效 a_bogus'));
      return;
    }

    pendingRequest.resolve(value);
  }

  private handleWorkerClose(
    worker: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    const expectedClose = this.closingWorkers.has(worker);
    this.closingWorkers.delete(worker);

    if (this.worker === worker) {
      this.worker = null;
      this.workerStdoutBuffer = '';
    }

    if (expectedClose) {
      return;
    }

    if (this.pendingRequests.size > 0) {
      const details = this.buildWorkerFailureDetails(code, signal);
      this.rejectAllPendingRequests(
        new Error(`a_bogus worker 已退出${details}`),
      );
      return;
    }

    if (code !== 0 || signal) {
      this.logger.warn(
        `a_bogus worker 非预期退出${this.buildWorkerFailureDetails(
          code,
          signal,
        )}`,
      );
    }
  }

  private failWorker(
    worker: ChildProcessWithoutNullStreams,
    error: Error,
  ): void {
    if (this.worker === worker) {
      this.worker = null;
    }

    this.workerStartPromise = null;
    this.workerStdoutBuffer = '';
    this.rejectAllPendingRequests(error);

    if (!worker.killed && worker.exitCode === null) {
      this.closingWorkers.add(worker);
      worker.kill();
    }
  }

  private stopWorker(error: Error): void {
    this.workerStartPromise = null;
    this.workerStdoutBuffer = '';
    this.rejectAllPendingRequests(error);

    const worker = this.worker;
    this.worker = null;

    if (!worker || worker.killed || worker.exitCode !== null) {
      return;
    }

    this.closingWorkers.add(worker);
    worker.kill('SIGTERM');
  }

  private rejectAllPendingRequests(error: Error): void {
    const pendingRequests = Array.from(this.pendingRequests.values());
    this.pendingRequests.clear();

    for (const pendingRequest of pendingRequests) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(error);
    }
  }

  private buildWorkerFailureDetails(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): string {
    const status = [`code=${code ?? 'null'}`];
    if (signal) {
      status.push(`signal=${signal}`);
    }
    const stderr = this.workerStderrBuffer.trim();
    if (stderr) {
      status.push(`stderr=${stderr.slice(-400)}`);
    }
    return ` (${status.join(', ')})`;
  }

  private async assertHelperExists(): Promise<void> {
    if (this.helperVerified) {
      return;
    }

    try {
      await access(this.helperPath);
      this.helperVerified = true;
    } catch (_error) {
      this.logger.error(`本地抖音 a_bogus helper 不存在: ${this.helperPath}`);
      throw new Error(`Local a_bogus helper is missing: ${this.helperPath}`);
    }
  }

  private readPositiveIntEnv(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
