import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { AuthHealthService } from '../auth-health/auth-health.service';
import { RuntimeFeatureEvent } from './entities/runtime-feature-event.entity';
import { RuntimeInterfaceEvent } from './entities/runtime-interface-event.entity';
import type {
  RuntimeChainDetail,
  RuntimeChainDetailStep,
  RuntimeChainListItem,
  RuntimeClientType,
  RuntimeDashboardTopError,
  RuntimeDashboardTrends,
  RuntimeDashboardWarning,
  RuntimeDashboardWindow,
  RuntimeFeature,
  RuntimeFeatureMetrics,
  RuntimeFeatureSummaryMap,
  RuntimeTraceStage,
  RuntimeTrendPoint,
  RuntimeOutcome,
  RuntimePlatform,
} from './runtime-monitor.types';
import {
  RUNTIME_CLIENT_TYPES,
  RUNTIME_PLATFORMS,
  normalizeLatencyMs,
  normalizeRuntimeClientType,
  normalizeRuntimeOutcome,
  normalizeRuntimePlatform,
  normalizeRuntimeTraceId,
} from './runtime-monitor.utils';

interface RecordRuntimeFeatureEventInput {
  feature: RuntimeFeature;
  clientType?: RuntimeClientType | string | null;
  platform?: RuntimePlatform | string | null;
  outcome?: RuntimeOutcome | string | null;
  latencyMs?: number;
  errorCode?: string | null;
  eventKey?: string | null;
  traceId?: string | null;
  candidateCount?: number | null;
  selectedCandidateIndex?: number | null;
  failoverCount?: number | null;
  selectedCandidateKind?: string | null;
  selectedQuality?: string | null;
}

interface RecordRuntimeInterfaceEventInput {
  traceId?: string | null;
  taskId?: string | null;
  platform?: RuntimePlatform | string | null;
  clientType?: RuntimeClientType | string | null;
  stage: RuntimeTraceStage;
  interfaceName: string;
  outcome?: RuntimeOutcome | string | null;
  latencyMs?: number;
  errorCode?: string | null;
}

interface EventRow {
  feature: RuntimeFeature;
  clientType: RuntimeClientType;
  platform: RuntimePlatform;
  outcome: RuntimeOutcome;
  latencyMs: number;
  errorCode: string | null;
  traceId: string | null;
  createdAt: Date;
}

interface InterfaceEventRow {
  traceId: string | null;
  taskId: string | null;
  platform: RuntimePlatform;
  clientType: RuntimeClientType;
  stage: RuntimeTraceStage;
  source: 'interface' | 'client';
  interfaceName: string;
  outcome: RuntimeOutcome;
  latencyMs: number;
  errorCode: string | null;
  createdAt: Date;
}

interface TrendBucketSeed {
  key: string;
  bucketStart: Date;
  bucketLabel: string;
}

const RETENTION_DAYS = 14;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class RuntimeMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeMonitorService.name);
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(RuntimeFeatureEvent)
    private readonly runtimeFeatureEventRepository: Repository<RuntimeFeatureEvent>,
    @InjectRepository(RuntimeInterfaceEvent)
    private readonly runtimeInterfaceEventRepository: Repository<RuntimeInterfaceEvent>,
    private readonly authHealthService: AuthHealthService,
  ) {}

  onModuleInit(): void {
    void this.cleanupExpiredEvents();
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredEvents();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  async recordServerEvent(input: RecordRuntimeFeatureEventInput) {
    await this.persistEvent(input);
    return {
      accepted: true,
      duplicate: false,
    };
  }

  async recordClientEvent(input: RecordRuntimeFeatureEventInput) {
    const eventKey = String(input.eventKey || '').trim();
    if (eventKey) {
      const existing = await this.runtimeFeatureEventRepository.findOne({
        where: { eventKey },
      });
      if (existing) {
        return {
          accepted: true,
          duplicate: true,
        };
      }
    }

    await this.persistEvent(input);
    return {
      accepted: true,
      duplicate: false,
    };
  }

  async recordInterfaceEvent(input: RecordRuntimeInterfaceEventInput) {
    const traceId = this.normalizeTraceId(input.traceId);
    const taskId = this.normalizeTaskId(input.taskId);
    if (!traceId && !taskId) {
      return {
        accepted: false,
      };
    }

    const event: Partial<RuntimeInterfaceEvent> = {
      traceId,
      taskId,
      platform: normalizeRuntimePlatform(input.platform),
      clientType: normalizeRuntimeClientType(input.clientType),
      stage: input.stage,
      interfaceName: this.normalizeInterfaceName(input.interfaceName),
      outcome: normalizeRuntimeOutcome(input.outcome),
      latencyMs: normalizeLatencyMs(input.latencyMs),
      errorCode: this.normalizeErrorCode(input.errorCode),
    };
    await this.runtimeInterfaceEventRepository.save(event);

    return {
      accepted: true,
    };
  }

  async getRuntimeDashboard(window: RuntimeDashboardWindow = 'today') {
    const now = new Date();
    const windowStart = this.resolveWindowStart(window, now);
    const warningStart = new Date(now.getTime() - 60 * 60 * 1000);

    const [events, warningEvents, authHealth] = await Promise.all([
      this.runtimeFeatureEventRepository.find({
        where: {
          createdAt: MoreThanOrEqual(windowStart),
        },
        order: {
          createdAt: 'DESC',
        },
      }),
      this.runtimeFeatureEventRepository.find({
        where: {
          createdAt: MoreThanOrEqual(warningStart),
        },
      }),
      this.authHealthService.getHealthStatus(false),
    ]);

    const normalizedRows = events.map((event) => this.toEventRow(event));
    const normalizedWarningRows = warningEvents.map((event) => this.toEventRow(event));

    return {
      window,
      generatedAt: now.toISOString(),
      summary: this.buildSummary(normalizedRows),
      trends: this.buildTrends(normalizedRows, window, now),
      byClient: this.buildByClient(normalizedRows),
      byPlatform: this.buildByPlatform(normalizedRows),
      authHealth: {
        ...authHealth,
        overallStatus: this.resolveOverallAuthStatus(authHealth.platforms),
      },
      warnings: this.buildWarnings(normalizedWarningRows, authHealth.platforms),
      topErrors: this.buildTopErrors(normalizedRows),
    };
  }

  async getRuntimeChains(input: {
    window?: RuntimeDashboardWindow;
    platform?: RuntimePlatform;
    limit?: number;
  }): Promise<RuntimeChainListItem[]> {
    const now = new Date();
    const window = input.window || 'today';
    const windowStart = this.resolveWindowStart(window, now);
    const limit = Math.min(5, Math.max(1, Number(input.limit) || 5));
    const normalizedPlatform = input.platform
      ? normalizeRuntimePlatform(input.platform)
      : null;

    const [interfaceEvents, featureEvents] = await Promise.all([
      this.runtimeInterfaceEventRepository.find({
        where: {
          createdAt: MoreThanOrEqual(windowStart),
        },
        order: {
          createdAt: 'DESC',
        },
        take: Math.max(limit * 40, 200),
      }),
      this.runtimeFeatureEventRepository.find({
        where: {
          createdAt: MoreThanOrEqual(windowStart),
        },
        order: {
          createdAt: 'DESC',
        },
        take: Math.max(limit * 40, 200),
      }),
    ]);

    const interfaceRows = interfaceEvents
      .map((event) => this.toInterfaceEventRow(event))
      .filter((item) => !!item.traceId)
      .filter((item) =>
        normalizedPlatform ? item.platform === normalizedPlatform : true,
      );

    const clientRows = featureEvents
      .map((event) => this.toEventRow(event))
      .filter((item) => !!item.traceId)
      .filter((item) =>
        normalizedPlatform ? item.platform === normalizedPlatform : true,
      );

    const grouped = new Map<
      string,
      {
        traceId: string;
        platform: RuntimePlatform;
        clientType: RuntimeClientType;
        startedAt: Date;
        endedAt: Date;
        interfaceLatencyMs: number;
        clientLatencyMs: number;
        hasFailure: boolean;
        stageCounts: Record<RuntimeTraceStage, number>;
      }
    >();

    for (const row of interfaceRows) {
      const traceId = row.traceId as string;
      const current = grouped.get(traceId) || {
        traceId,
        platform: row.platform,
        clientType: row.clientType,
        startedAt: row.createdAt,
        endedAt: row.createdAt,
        interfaceLatencyMs: 0,
        clientLatencyMs: 0,
        hasFailure: false,
        stageCounts: {
          parse: 0,
          preview: 0,
          download: 0,
        },
      };

      if (current.platform === 'unknown' && row.platform !== 'unknown') {
        current.platform = row.platform;
      }
      if (current.clientType === 'unknown' && row.clientType !== 'unknown') {
        current.clientType = row.clientType;
      }

      if (row.createdAt < current.startedAt) {
        current.startedAt = row.createdAt;
      }
      if (row.createdAt > current.endedAt) {
        current.endedAt = row.createdAt;
      }

      current.interfaceLatencyMs += row.latencyMs;
      current.stageCounts[row.stage] += 1;
      if (row.outcome === 'failure') {
        current.hasFailure = true;
      }

      grouped.set(traceId, current);
    }

    for (const row of clientRows) {
      const traceId = row.traceId as string;
      const current = grouped.get(traceId) || {
        traceId,
        platform: row.platform,
        clientType: row.clientType,
        startedAt: row.createdAt,
        endedAt: row.createdAt,
        interfaceLatencyMs: 0,
        clientLatencyMs: 0,
        hasFailure: false,
        stageCounts: {
          parse: 0,
          preview: 0,
          download: 0,
        },
      };

      if (current.platform === 'unknown' && row.platform !== 'unknown') {
        current.platform = row.platform;
      }
      if (current.clientType === 'unknown' && row.clientType !== 'unknown') {
        current.clientType = row.clientType;
      }
      if (row.createdAt < current.startedAt) {
        current.startedAt = row.createdAt;
      }
      if (row.createdAt > current.endedAt) {
        current.endedAt = row.createdAt;
      }
      current.clientLatencyMs += row.latencyMs;
      current.stageCounts[row.feature] += 1;
      if (row.outcome === 'failure') {
        current.hasFailure = true;
      }

      grouped.set(traceId, current);
    }

    return Array.from(grouped.values())
      .sort((left, right) => right.endedAt.getTime() - left.endedAt.getTime())
      .slice(0, limit)
      .map((item) => ({
        traceId: item.traceId,
        platform: item.platform,
        clientType: item.clientType,
        startedAt: item.startedAt.toISOString(),
        endedAt: item.endedAt.toISOString(),
        totalDurationMs: Math.max(0, item.endedAt.getTime() - item.startedAt.getTime()),
        interfaceLatencyMs: Math.max(0, Math.round(item.interfaceLatencyMs)),
        clientLatencyMs: Math.max(0, Math.round(item.clientLatencyMs)),
        combinedLatencyMs: Math.max(
          0,
          Math.round(item.interfaceLatencyMs + item.clientLatencyMs),
        ),
        parseToPreviewReadyMs: this.deriveParseToPreviewReadyMs(
          interfaceRows.filter((row) => row.traceId === item.traceId),
          clientRows
            .filter((row) => row.traceId === item.traceId)
            .map((row) => ({
              traceId: row.traceId,
              taskId: null,
              platform: row.platform,
              clientType: row.clientType,
              stage: row.feature,
              source: 'client' as const,
              interfaceName: `client.${row.feature}`,
              outcome: row.outcome,
              latencyMs: row.latencyMs,
              errorCode: row.errorCode,
              createdAt: row.createdAt,
            })),
        ),
        hasFailure: item.hasFailure,
        stageCounts: item.stageCounts,
      }));
  }

  async getRuntimeChainDetail(traceIdInput: string): Promise<RuntimeChainDetail> {
    const traceId = this.normalizeTraceId(traceIdInput);
    if (!traceId) {
      throw new NotFoundException('链路不存在');
    }

    const [interfaceEvents, featureEvents] = await Promise.all([
      this.runtimeInterfaceEventRepository.find({
        where: {
          traceId,
        },
        order: {
          createdAt: 'ASC',
        },
      }),
      this.runtimeFeatureEventRepository.find({
        where: {
          traceId,
        },
        order: {
          createdAt: 'ASC',
        },
      }),
    ]);

    const rows = interfaceEvents.map((item) => this.toInterfaceEventRow(item));

    const clientRows: InterfaceEventRow[] = featureEvents.map((item) => {
      const event = this.toEventRow(item);
      return {
        traceId,
        taskId: null,
        platform: event.platform,
        clientType: event.clientType,
        stage: event.feature,
        source: 'client',
        interfaceName: `client.${event.feature}`,
        outcome: event.outcome,
        latencyMs: event.latencyMs,
        errorCode: event.errorCode,
        createdAt: event.createdAt,
      };
    });

    const mergedRows = [...rows, ...clientRows].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );

    if (mergedRows.length === 0) {
      throw new NotFoundException('链路不存在');
    }

    const first = mergedRows[0];
    const last = mergedRows[mergedRows.length - 1];

    const stages: Record<RuntimeTraceStage, RuntimeChainDetailStep[]> = {
      parse: [],
      preview: [],
      download: [],
    };

    let platform: RuntimePlatform = first.platform;
    let clientType: RuntimeClientType = first.clientType;
    let hasFailure = false;
    let interfaceLatencyMs = 0;
    let clientLatencyMs = 0;

    for (const row of mergedRows) {
      if (platform === 'unknown' && row.platform !== 'unknown') {
        platform = row.platform;
      }
      if (clientType === 'unknown' && row.clientType !== 'unknown') {
        clientType = row.clientType;
      }
      if (row.outcome === 'failure') {
        hasFailure = true;
      }
      if (row.source === 'interface') {
        interfaceLatencyMs += row.latencyMs;
      } else {
        clientLatencyMs += row.latencyMs;
      }
      stages[row.stage].push({
        interfaceName: row.interfaceName,
        stage: row.stage,
        source: row.source,
        outcome: row.outcome,
        latencyMs: row.latencyMs,
        errorCode: row.errorCode,
        createdAt: row.createdAt.toISOString(),
        taskId: row.taskId,
      });
    }

    (['parse', 'preview', 'download'] as const).forEach((stage) => {
      stages[stage].sort((left, right) => {
        const sourceGap =
          (left.source === 'client' ? 0 : 1) - (right.source === 'client' ? 0 : 1);
        if (sourceGap !== 0) {
          return sourceGap;
        }
        return (
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
        );
      });
    });

    return {
      traceId,
      platform,
      clientType,
      startedAt: first.createdAt.toISOString(),
      endedAt: last.createdAt.toISOString(),
      totalDurationMs: Math.max(0, last.createdAt.getTime() - first.createdAt.getTime()),
      interfaceLatencyMs: Math.max(0, Math.round(interfaceLatencyMs)),
      clientLatencyMs: Math.max(0, Math.round(clientLatencyMs)),
      combinedLatencyMs: Math.max(
        0,
        Math.round(interfaceLatencyMs + clientLatencyMs),
      ),
      parseToPreviewReadyMs: this.deriveParseToPreviewReadyMs(rows, clientRows),
      hasFailure,
      stages,
    };
  }

  async cleanupExpiredEvents() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      await Promise.all([
        this.runtimeFeatureEventRepository.delete({
          createdAt: LessThan(cutoff),
        }),
        this.runtimeInterfaceEventRepository.delete({
          createdAt: LessThan(cutoff),
        }),
      ]);
    } catch (error: any) {
      this.logger.warn(`runtime event cleanup failed: ${error?.message || 'unknown'}`);
    }
  }

  private async persistEvent(input: RecordRuntimeFeatureEventInput) {
    const event: Partial<RuntimeFeatureEvent> = {
      feature: input.feature,
      clientType: normalizeRuntimeClientType(input.clientType),
      platform: normalizeRuntimePlatform(input.platform),
      outcome: normalizeRuntimeOutcome(input.outcome),
      latencyMs: normalizeLatencyMs(input.latencyMs),
      errorCode: this.normalizeErrorCode(input.errorCode),
      eventKey: this.normalizeEventKey(input.eventKey),
      traceId: this.normalizeTraceId(input.traceId),
      candidateCount: this.normalizeOptionalCount(input.candidateCount),
      selectedCandidateIndex: this.normalizeOptionalCount(input.selectedCandidateIndex),
      failoverCount: this.normalizeOptionalCount(input.failoverCount),
      selectedCandidateKind: this.normalizeOptionalLabel(input.selectedCandidateKind, 64),
      selectedQuality: this.normalizeOptionalLabel(input.selectedQuality, 32),
    };
    await this.runtimeFeatureEventRepository.save(event);
  }

  private normalizeEventKey(value: string | null | undefined): string | null {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, 128) : null;
  }

  private normalizeErrorCode(value: string | null | undefined): string | null {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }
    const uppercased = normalized.slice(0, 96).toUpperCase();
    return uppercased === 'NONE' ? null : uppercased;
  }

  private normalizeTraceId(value: unknown): string | null {
    return normalizeRuntimeTraceId(value);
  }

  private normalizeOptionalCount(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    return Math.trunc(parsed);
  }

  private normalizeOptionalLabel(
    value: unknown,
    maxLength: number,
  ): string | null {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return null;
    }
    return normalized.slice(0, maxLength);
  }

  private normalizeTaskId(value: unknown): string | null {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, 64) : null;
  }

  private normalizeInterfaceName(value: unknown): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return 'unknown';
    }
    return normalized.slice(0, 64);
  }

  private normalizeRuntimeStage(value: unknown): RuntimeTraceStage {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'parse' || normalized === 'download') {
      return normalized;
    }
    return 'preview';
  }

  private deriveParseToPreviewReadyMs(
    interfaceRows: InterfaceEventRow[],
    clientRows: InterfaceEventRow[],
  ): number | null {
    const parseCompletedAt = this.resolveParseCompletedAt(interfaceRows, clientRows);
    const previewReadyAt = clientRows
      .filter((row) => row.stage === 'preview' && row.outcome === 'success')
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0]
      ?.createdAt;

    if (!parseCompletedAt || !previewReadyAt) {
      return null;
    }

    return Math.max(0, previewReadyAt.getTime() - parseCompletedAt.getTime());
  }

  private resolveParseCompletedAt(
    interfaceRows: InterfaceEventRow[],
    clientRows: InterfaceEventRow[],
  ): Date | null {
    const clientParseSuccess = clientRows
      .filter((row) => row.stage === 'parse' && row.outcome === 'success')
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0]
      ?.createdAt;
    if (clientParseSuccess) {
      return clientParseSuccess;
    }

    return interfaceRows
      .filter((row) => row.stage === 'parse' && row.outcome === 'success')
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0]
      ?.createdAt || null;
  }

  private resolveWindowStart(window: RuntimeDashboardWindow, now: Date): Date {
    if (window === 'today') {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (window === '7d') {
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  private toEventRow(event: Partial<RuntimeFeatureEvent>): EventRow {
    return {
      feature: (event.feature || 'parse') as RuntimeFeature,
      clientType: normalizeRuntimeClientType(event.clientType),
      platform: normalizeRuntimePlatform(event.platform),
      outcome: normalizeRuntimeOutcome(event.outcome),
      latencyMs: normalizeLatencyMs(event.latencyMs),
      errorCode: this.normalizeErrorCode(event.errorCode as string | null | undefined),
      traceId: this.normalizeTraceId(event.traceId),
      createdAt:
        event.createdAt instanceof Date ? event.createdAt : new Date(event.createdAt || Date.now()),
    };
  }

  private toInterfaceEventRow(
    event: Partial<RuntimeInterfaceEvent>,
  ): InterfaceEventRow {
    return {
      traceId: this.normalizeTraceId(event.traceId),
      taskId: this.normalizeTaskId(event.taskId),
      platform: normalizeRuntimePlatform(event.platform),
      clientType: normalizeRuntimeClientType(event.clientType),
      stage: this.normalizeRuntimeStage(event.stage),
      source: 'interface',
      interfaceName: this.normalizeInterfaceName(event.interfaceName),
      outcome: normalizeRuntimeOutcome(event.outcome),
      latencyMs: normalizeLatencyMs(event.latencyMs),
      errorCode: this.normalizeErrorCode(event.errorCode as string | null | undefined),
      createdAt:
        event.createdAt instanceof Date ? event.createdAt : new Date(event.createdAt || Date.now()),
    };
  }

  private buildSummary(rows: EventRow[]): RuntimeFeatureSummaryMap {
    return {
      parse: this.buildFeatureMetrics(rows.filter((item) => item.feature === 'parse')),
      preview: this.buildFeatureMetrics(rows.filter((item) => item.feature === 'preview')),
      download: this.buildFeatureMetrics(rows.filter((item) => item.feature === 'download')),
    };
  }

  private buildByClient(rows: EventRow[]) {
    return RUNTIME_CLIENT_TYPES.map((clientType) => ({
      clientType,
      features: this.buildSummary(rows.filter((item) => item.clientType === clientType)),
    }));
  }

  private buildByPlatform(rows: EventRow[]) {
    return RUNTIME_PLATFORMS.map((platform) => ({
      platform,
      features: this.buildSummary(rows.filter((item) => item.platform === platform)),
    }));
  }

  private buildTrends(
    rows: EventRow[],
    window: RuntimeDashboardWindow,
    now: Date,
  ): RuntimeDashboardTrends {
    const buckets = this.createTrendBuckets(window, now);
    return {
      parse: this.buildFeatureTrend(
        rows.filter((item) => item.feature === 'parse'),
        buckets,
        window,
      ),
      preview: this.buildFeatureTrend(
        rows.filter((item) => item.feature === 'preview'),
        buckets,
        window,
      ),
      download: this.buildFeatureTrend(
        rows.filter((item) => item.feature === 'download'),
        buckets,
        window,
      ),
    };
  }

  private buildFeatureMetrics(rows: EventRow[]): RuntimeFeatureMetrics {
    const total = rows.length;
    if (!total) {
      return {
        total: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        avgLatencyMs: null,
        p95LatencyMs: null,
      };
    }

    const successCount = rows.filter((item) => item.outcome === 'success').length;
    const failureCount = total - successCount;
    const latencies = rows
      .map((item) => normalizeLatencyMs(item.latencyMs))
      .sort((a, b) => a - b);
    const totalLatency = latencies.reduce((sum, value) => sum + value, 0);
    const p95Index = Math.max(0, Math.ceil(total * 0.95) - 1);

    return {
      total,
      successCount,
      failureCount,
      successRate: Number(((successCount / total) * 100).toFixed(1)),
      avgLatencyMs: Math.round(totalLatency / total),
      p95LatencyMs: latencies[p95Index] ?? null,
    };
  }

  private buildFeatureTrend(
    rows: EventRow[],
    buckets: TrendBucketSeed[],
    window: RuntimeDashboardWindow,
  ): RuntimeTrendPoint[] {
    const grouped = new Map<string, EventRow[]>();

    for (const row of rows) {
      const key = this.resolveTrendBucketKey(row.createdAt, window);
      const current = grouped.get(key) || [];
      current.push(row);
      grouped.set(key, current);
    }

    return buckets.map((bucket) => ({
      bucketStart: bucket.bucketStart.toISOString(),
      bucketLabel: bucket.bucketLabel,
      ...this.buildFeatureMetrics(grouped.get(bucket.key) || []),
    }));
  }

  private createTrendBuckets(
    window: RuntimeDashboardWindow,
    now: Date,
  ): TrendBucketSeed[] {
    if (window === '7d') {
      const end = this.startOfDay(now);
      return Array.from({ length: 7 }, (_, index) => {
        const offset = 6 - index;
        const bucketStart = new Date(end.getTime() - offset * 24 * 60 * 60 * 1000);
        return {
          key: this.resolveDayKey(bucketStart),
          bucketStart,
          bucketLabel: this.formatDayLabel(bucketStart),
        };
      });
    }

    const currentHourStart = this.startOfHour(now);
    const lastCompletedHourStart = new Date(
      currentHourStart.getTime() - 60 * 60 * 1000,
    );

    if (window === 'today') {
      const dayStart = this.startOfDay(now);
      if (lastCompletedHourStart < dayStart) {
        return [
          {
            key: this.resolveHourKey(dayStart),
            bucketStart: dayStart,
            bucketLabel: this.formatHourLabel(dayStart),
          },
        ];
      }

      const hourCount = Math.floor(
        (lastCompletedHourStart.getTime() - dayStart.getTime()) /
          (60 * 60 * 1000),
      ) + 1;

      return Array.from({ length: hourCount }, (_, index) => {
        const bucketStart = new Date(dayStart.getTime() + index * 60 * 60 * 1000);
        return {
          key: this.resolveHourKey(bucketStart),
          bucketStart,
          bucketLabel: this.formatHourLabel(bucketStart),
        };
      });
    }

    const firstHourStart = new Date(
      lastCompletedHourStart.getTime() - 23 * 60 * 60 * 1000,
    );

    return Array.from({ length: 24 }, (_, index) => {
      const bucketStart = new Date(
        firstHourStart.getTime() + index * 60 * 60 * 1000,
      );
      return {
        key: this.resolveHourKey(bucketStart),
        bucketStart,
        bucketLabel: this.formatHourLabel(bucketStart),
      };
    });
  }

  private resolveTrendBucketKey(
    date: Date,
    window: RuntimeDashboardWindow,
  ): string {
    return window === '7d'
      ? this.resolveDayKey(date)
      : this.resolveHourKey(date);
  }

  private resolveHourKey(date: Date): string {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
      String(date.getHours()).padStart(2, '0'),
    ].join('-');
  }

  private resolveDayKey(date: Date): string {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  private startOfHour(date: Date): Date {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      0,
      0,
      0,
    );
  }

  private startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private formatHourLabel(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:00`;
  }

  private formatDayLabel(date: Date): string {
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`;
  }

  private buildTopErrors(rows: EventRow[]): RuntimeDashboardTopError[] {
    const groups = new Map<
      string,
      {
        feature: RuntimeFeature;
        errorCode: string;
        count: number;
        clientTypes: Set<RuntimeClientType>;
        platforms: Set<RuntimePlatform>;
      }
    >();

    for (const row of rows) {
      if (row.outcome !== 'failure' || !row.errorCode) {
        continue;
      }
      const key = `${row.feature}:${row.errorCode}`;
      const existing = groups.get(key) || {
        feature: row.feature,
        errorCode: row.errorCode,
        count: 0,
        clientTypes: new Set<RuntimeClientType>(),
        platforms: new Set<RuntimePlatform>(),
      };
      existing.count += 1;
      existing.clientTypes.add(row.clientType);
      existing.platforms.add(row.platform);
      groups.set(key, existing);
    }

    return Array.from(groups.values())
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.errorCode.localeCompare(right.errorCode);
      })
      .slice(0, 8)
      .map((item) => ({
        feature: item.feature,
        errorCode: item.errorCode,
        count: item.count,
        clientTypes: Array.from(item.clientTypes),
        platforms: Array.from(item.platforms),
      }));
  }

  private buildWarnings(
    warningRows: EventRow[],
    authPlatforms: Record<
      string,
      {
        platform: string;
        status: string;
        consecutiveFailures: number;
        lastError: string | null;
      }
    >,
  ): RuntimeDashboardWarning[] {
    const warnings: RuntimeDashboardWarning[] = [];
    const thresholds: Array<{
      feature: RuntimeFeature;
      minSamples: number;
      successRate: number;
      p95LatencyMs: number;
      severity: 'warning' | 'critical';
    }> = [
      { feature: 'parse', minSamples: 20, successRate: 95, p95LatencyMs: 8000, severity: 'warning' },
      { feature: 'preview', minSamples: 20, successRate: 95, p95LatencyMs: 10000, severity: 'warning' },
      { feature: 'download', minSamples: 10, successRate: 90, p95LatencyMs: 90000, severity: 'critical' },
    ];

    for (const threshold of thresholds) {
      const metrics = this.buildFeatureMetrics(
        warningRows.filter((item) => item.feature === threshold.feature),
      );
      if (metrics.total < threshold.minSamples) {
        continue;
      }

      if (metrics.successRate < threshold.successRate) {
        warnings.push({
          source: threshold.feature,
          severity: threshold.severity,
          title: `${this.getFeatureLabel(threshold.feature)}成功率偏低`,
          detail: `最近 1 小时成功率 ${metrics.successRate}% ，低于阈值 ${threshold.successRate}%`,
        });
      }

      if (
        typeof metrics.p95LatencyMs === 'number' &&
        metrics.p95LatencyMs > threshold.p95LatencyMs
      ) {
        warnings.push({
          source: threshold.feature,
          severity: threshold.severity,
          title: `${this.getFeatureLabel(threshold.feature)}耗时偏高`,
          detail: `最近 1 小时 P95 ${metrics.p95LatencyMs}ms ，超过阈值 ${threshold.p95LatencyMs}ms`,
        });
      }
    }

    for (const platform of Object.values(authPlatforms)) {
      if (platform.status === 'invalid' || platform.status === 'degraded') {
        warnings.push({
          source: 'auth',
          severity: platform.status === 'invalid' ? 'critical' : 'warning',
          title: `${platform.platform} 登录态异常`,
          detail:
            platform.lastError ||
            `当前状态 ${platform.status}，连续失败 ${platform.consecutiveFailures} 次`,
          actionTab: 'auth',
        });
      }
    }

    return warnings;
  }

  private resolveOverallAuthStatus(
    platforms: Record<string, { status: string }>,
  ): string {
    const statuses = Object.values(platforms).map((item) => item.status);
    if (statuses.includes('invalid')) {
      return 'invalid';
    }
    if (statuses.includes('degraded')) {
      return 'degraded';
    }
    if (statuses.every((item) => item === 'healthy')) {
      return 'healthy';
    }
    return 'unknown';
  }

  private getFeatureLabel(feature: RuntimeFeature): string {
    switch (feature) {
      case 'parse':
        return '视频解析';
      case 'preview':
        return '预览';
      case 'download':
        return '下载';
      default:
        return feature;
    }
  }
}
