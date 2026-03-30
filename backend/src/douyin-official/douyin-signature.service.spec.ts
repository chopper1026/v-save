import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DouyinSignatureService } from './douyin-signature.service';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

interface MockWorkerRequest {
  id: number;
  payload: Record<string, unknown>;
}

class MockPythonWorker extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = jest.fn((signal?: NodeJS.Signals) => {
    this.killed = true;
    this.signalCode = signal || null;
    this.exitCode = 0;
    this.stdin.end();
    this.stdout.end();
    this.stderr.end();
    this.emit('close', 0, signal || null);
    return true;
  });

  private buffer = '';

  constructor(
    private readonly onRequest: (request: MockWorkerRequest, worker: MockPythonWorker) => void,
  ) {
    super();

    this.stdin.on('data', (chunk) => {
      this.buffer += chunk.toString();
      let newlineIndex = this.buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line) {
          this.onRequest(JSON.parse(line) as MockWorkerRequest, this);
        }
        newlineIndex = this.buffer.indexOf('\n');
      }
    });

    process.nextTick(() => {
      this.emit('spawn');
    });
  }
}

describe('DouyinSignatureService', () => {
  const spawn = jest.requireMock('node:child_process').spawn as jest.Mock;
  let service: DouyinSignatureService;
  const originalEnv = process.env;
  let helperDir = '';
  let helperPath = '';

  beforeEach(() => {
    jest.clearAllMocks();
    helperDir = mkdtempSync(join(tmpdir(), 'douyin-abogus-test-'));
    helperPath = join(helperDir, 'abogus.py');
    writeFileSync(helperPath, '# helper stub\n');
    process.env = {
      ...originalEnv,
      DOUYIN_ABOGUS_HELPER_PATH: helperPath,
    };
    service = new DouyinSignatureService();
  });

  afterEach(async () => {
    await service.onModuleDestroy?.();
    if (helperDir) {
      rmSync(helperDir, { recursive: true, force: true });
    }
    process.env = originalEnv;
  });

  it('reuses one local python worker across multiple requests', async () => {
    spawn.mockImplementation(() =>
      new MockPythonWorker((request, worker) => {
        worker.stdout.write(
          `${JSON.stringify({
            id: request.id,
            a_bogus: `bogus-${String(request.payload.aweme_id || '')}`,
          })}\n`,
        );
      }),
    );

    const first = await service.generateABogus({
      aid: '6383',
      version_code: '290100',
      aweme_id: 'first',
      msToken: '',
    });
    const second = await service.generateABogus({
      aid: '6383',
      version_code: '290100',
      aweme_id: 'second',
      msToken: '',
    });

    expect(first).toBe('bogus-first');
    expect(second).toBe('bogus-second');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('matches concurrent responses by request id', async () => {
    spawn.mockImplementation(() =>
      new MockPythonWorker((request, worker) => {
        const delay = String(request.payload.aweme_id) === 'slow' ? 15 : 0;
        setTimeout(() => {
          worker.stdout.write(
            `${JSON.stringify({
              id: request.id,
              a_bogus: `bogus-${String(request.payload.aweme_id || '')}`,
            })}\n`,
          );
        }, delay);
      }),
    );

    const [slow, fast] = await Promise.all([
      service.generateABogus({
        aid: '6383',
        version_code: '290100',
        aweme_id: 'slow',
        msToken: '',
      }),
      service.generateABogus({
        aid: '6383',
        version_code: '290100',
        aweme_id: 'fast',
        msToken: '',
      }),
    ]);

    expect(slow).toBe('bogus-slow');
    expect(fast).toBe('bogus-fast');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('builds a local msToken fallback value', () => {
    const token = service.generateMsToken();

    expect(token).toHaveLength(128);
    expect(token.endsWith('==')).toBe(true);
  });

  it('fails fast when the bundled local helper is missing', async () => {
    rmSync(helperPath, { force: true });

    await expect(
      service.generateABogus({
        aid: '6383',
        version_code: '290100',
        aweme_id: '7617779361726336307',
        msToken: '',
      }),
    ).rejects.toThrow(/a_bogus helper/i);
  });

  it('stops the worker on module destroy', async () => {
    let worker: MockPythonWorker;
    spawn.mockImplementation(() => {
      worker = new MockPythonWorker((request, currentWorker) => {
        currentWorker.stdout.write(
          `${JSON.stringify({
            id: request.id,
            a_bogus: 'bogus-destroy',
          })}\n`,
        );
      });
      return worker;
    });

    await service.generateABogus({
      aid: '6383',
      version_code: '290100',
      aweme_id: 'destroy',
      msToken: '',
    });

    await service.onModuleDestroy?.();

    expect(worker!.kill).toHaveBeenCalledTimes(1);
  });
});
