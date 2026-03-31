export type Platform =
  | 'douyin'
  | 'bilibili'
  | 'xiaohongshu'
  | 'kuaishou'
  | 'youtube'
  | 'unknown';

export interface ApiUser {
  id: string;
  email: string;
  nickname: string;
  role?: 'SUPER_ADMIN' | 'USER';
  accountStatus?: 'ACTIVE' | 'DISABLED';
  phone?: string | null;
  avatar?: string | null;
  downloadCount?: number;
}

export interface AuthResponse {
  access_token: string;
  user: ApiUser;
}

export interface PublicSystemSettings {
  registrationEnabled: boolean;
}

export interface PublicSystemSettingsResponse {
  success?: boolean;
  data?: PublicSystemSettings;
}

export interface UserProfile extends ApiUser {
  createdAt?: string;
  updatedAt?: string;
}

export type ClientType = 'WEB' | 'MOBILE';

export interface ParsedVideo {
  title: string;
  cover: string;
  duration: string;
  platform: Platform;
  author: string;
  videoUrl: string;
  audioUrl?: string;
  qualityStatus?:
    | 'complete'
    | 'enriching'
    | 'session_required'
    | 'source_single_quality';
  qualityRefreshKey?: string;
  qualityMessage?: string;
  downloadOptions?: {
    merged?: Record<string, string>;
    video?: Record<string, string>;
    videoCandidates?: Record<
      string,
      Array<{
        url: string;
        codecid?: number;
        width?: number;
        height?: number;
        frameRate?: number;
        bandwidth?: number;
        fileId?: string;
        sourceKind?: string;
        watermark?: boolean;
      }>
    >;
    audio?: Record<string, string>;
  };
}

export interface PreviewCandidate {
  identity: string;
  url: string;
  isProxy: boolean;
  quality: string;
  sourceKind: string;
  watermark: boolean;
  codecId?: number;
  priorityReason: string;
}

export interface ParsedVideoView extends ParsedVideo {
  originalCover: string;
  originalVideoUrl: string;
  originalAudioUrl?: string;
  previewCoverUrl: string;
  previewVideoCandidates: PreviewCandidate[];
  runtimeTraceId?: string;
}

export interface DownloadGetUrlPayload {
  downloadUrl: string;
  quality?: string;
  format?: string;
  fileExtension?: string;
  title?: string;
  actualQuality?: string;
  actualWidth?: number;
  actualHeight?: number;
}

export interface DownloadGetUrlRequest {
  videoInfo: string;
  format: 'audio' | 'mp4';
  quality?: string;
  clientType: ClientType;
  iosCompatible?: boolean;
  allowWatermarkFallback?: boolean;
}

export interface DownloadTaskPayload {
  id: string;
  status:
    | 'queued'
    | 'processing'
    | 'downloading'
    | 'merging'
    | 'completed'
    | 'failed'
    | 'expired';
  progress?: number;
  message?: string;
  downloadUrl?: string;
  fileExtension?: string;
  runtimeTraceId?: string;
}

export interface DownloadHistoryItem {
  id: string;
  videoTitle: string;
  videoUrl: string;
  sourceUrl?: string | null;
  platform: Platform;
  coverUrl?: string | null;
  format?: string;
  quality?: string;
  downloadUrl?: string;
  status: string;
  createdAt: string;
}

export interface HistoryListMeta {
  limit: number;
  offset: number;
  count: number;
  hasMore: boolean;
  nextOffset: number;
}

export interface HistoryListResponse {
  success?: boolean;
  data?: DownloadHistoryItem[];
  meta?: HistoryListMeta;
}

export interface NotificationItem {
  id: string;
  userId: string | null;
  type: string;
  level: 'info' | 'success' | 'warn' | 'error';
  source: string;
  title: string;
  content: string;
  actionUrl?: string | null;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  success?: boolean;
  data?: NotificationItem[];
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
  };
}

export interface NotificationUnreadCountResponse {
  success?: boolean;
  data?: {
    count?: number;
  };
}

export interface MobileUser {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'USER';
  accountStatus: 'ACTIVE' | 'DISABLED';
  phone?: string | null;
  avatar?: string;
  downloadCount?: number;
}
