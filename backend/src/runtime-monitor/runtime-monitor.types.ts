export type RuntimeFeature = 'parse' | 'preview' | 'download';
export type RuntimeClientType = 'WEB' | 'MOBILE' | 'unknown';
export type RuntimePlatform =
  | 'douyin'
  | 'bilibili'
  | 'xiaohongshu'
  | 'kuaishou'
  | 'youtube'
  | 'unknown';
export type RuntimeOutcome = 'success' | 'failure';
export type RuntimeDashboardWindow = 'today' | '24h' | '7d';
export type RuntimeWarningSeverity = 'warning' | 'critical';
export type RuntimeTraceStage = 'parse' | 'preview' | 'download';

export interface RuntimeFeatureMetrics {
  total: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface RuntimeFeatureSummaryMap {
  parse: RuntimeFeatureMetrics;
  preview: RuntimeFeatureMetrics;
  download: RuntimeFeatureMetrics;
}

export interface RuntimeTrendPoint extends RuntimeFeatureMetrics {
  bucketStart: string;
  bucketLabel: string;
}

export interface RuntimeDashboardTrends {
  parse: RuntimeTrendPoint[];
  preview: RuntimeTrendPoint[];
  download: RuntimeTrendPoint[];
}

export interface RuntimeDashboardWarning {
  source: RuntimeFeature | 'auth';
  severity: RuntimeWarningSeverity;
  title: string;
  detail: string;
  actionTab?: 'auth';
}

export interface RuntimeDashboardTopError {
  feature: RuntimeFeature;
  errorCode: string;
  count: number;
  clientTypes: RuntimeClientType[];
  platforms: RuntimePlatform[];
}

export interface RuntimeChainListItem {
  traceId: string;
  platform: RuntimePlatform;
  clientType: RuntimeClientType;
  startedAt: string;
  endedAt: string;
  totalDurationMs: number;
  interfaceLatencyMs: number;
  clientLatencyMs: number;
  combinedLatencyMs: number;
  parseToPreviewReadyMs: number | null;
  hasFailure: boolean;
  stageCounts: Record<RuntimeTraceStage, number>;
}

export interface RuntimeChainDetailStep {
  interfaceName: string;
  stage: RuntimeTraceStage;
  source: 'interface' | 'client';
  outcome: RuntimeOutcome;
  latencyMs: number;
  errorCode: string | null;
  createdAt: string;
  taskId: string | null;
}

export interface RuntimeChainDetail {
  traceId: string;
  platform: RuntimePlatform;
  clientType: RuntimeClientType;
  startedAt: string;
  endedAt: string;
  totalDurationMs: number;
  interfaceLatencyMs: number;
  clientLatencyMs: number;
  combinedLatencyMs: number;
  parseToPreviewReadyMs: number | null;
  hasFailure: boolean;
  stages: Record<RuntimeTraceStage, RuntimeChainDetailStep[]>;
}
