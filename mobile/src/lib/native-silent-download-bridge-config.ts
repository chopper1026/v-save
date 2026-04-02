import type { PersistedSilentDownloadQueueState } from '@/store/silent-download-persistence-snapshot';

interface ResolveNativeSilentDownloadBridgeAuthTokenInput {
  authHydrated: boolean;
  token?: string | null;
}

interface NativeSilentDownloadBridgePayloadInput {
  apiBaseUrl: string;
  enabled: boolean;
  authToken?: string | null;
  legacyState?: PersistedSilentDownloadQueueState | null;
}

export const normalizeNativeSilentDownloadBridgeAuthToken = (
  authToken?: string | null,
): string | null | undefined => {
  if (authToken === undefined) {
    return undefined;
  }

  const normalized = String(authToken || '').trim();
  return normalized || null;
};

export const resolveNativeSilentDownloadBridgeAuthToken = (
  input: ResolveNativeSilentDownloadBridgeAuthTokenInput,
): string | null | undefined => {
  if (!input.authHydrated) {
    return undefined;
  }

  return normalizeNativeSilentDownloadBridgeAuthToken(input.token);
};

export const shouldConfigureNativeSilentDownloadBridge = (input: {
  useNativeEngine: boolean;
  settingsHydrated: boolean;
  authHydrated: boolean;
}): boolean => {
  return (
    input.useNativeEngine &&
    input.settingsHydrated &&
    input.authHydrated
  );
};

export const buildNativeSilentDownloadBridgePayload = (
  input: NativeSilentDownloadBridgePayloadInput,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    apiBaseUrl: String(input.apiBaseUrl || '').trim(),
    enabled: input.enabled === true,
  };
  const authToken = normalizeNativeSilentDownloadBridgeAuthToken(input.authToken);
  if (authToken !== undefined) {
    payload.authToken = authToken;
  }
  if (input.legacyState !== undefined) {
    payload.legacyState = input.legacyState;
  }
  return payload;
};
