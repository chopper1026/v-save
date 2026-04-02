const isDevRuntime = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

export const logSilentDownloadDebug = (
  event: string,
  payload?: Record<string, unknown>
) => {
  if (!isDevRuntime) {
    return;
  }

  if (payload) {
    console.log(`[SILENT_DOWNLOAD] ${event}`, payload);
    return;
  }

  console.log(`[SILENT_DOWNLOAD] ${event}`);
};
