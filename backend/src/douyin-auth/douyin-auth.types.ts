import {
  DouyinBridgeAuthSession,
  DouyinBridgeAuthSessionStatus,
} from './entities/douyin-bridge-auth-session.entity';

export type AuthSource = 'database' | 'environment' | 'none';

export interface DouyinAuthStatus {
  hasCookie: boolean;
  source: AuthSource;
  lastError: string | null;
  lastCheckAt: string | null;
  updatedAt: string | null;
  cookiePreview: string | null;
}

export interface DouyinBridgeAuthSessionPayload {
  authSessionId: string;
  expiresAt: string;
  uploadToken: string;
}

export interface DouyinBridgeCreateSessionInput {
  initiatedByAdminUserId?: string;
  initiatedByAdminEmail?: string;
}

export interface DouyinBridgeCompleteSessionInput {
  authSessionId: string;
  uploadToken: string;
}

export interface DouyinBridgeCompleteSessionPayload {
  authSessionId: string;
  status: DouyinBridgeAuthSessionStatus.Completed;
  completedAt: string;
  initiatedByAdminUserId: string | null;
  initiatedByAdminEmail: string | null;
}

export interface DouyinBridgePreparedSessionPayload {
  authSessionId: string;
  initiatedByAdminUserId: string | null;
  initiatedByAdminEmail: string | null;
  session: DouyinBridgeAuthSession;
}
