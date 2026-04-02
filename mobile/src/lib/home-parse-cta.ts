export const resolveHomeParseCtaState = ({
  parseLoading,
  autoParsing,
  shareAutoParsePending,
  incomingUrlPresent,
  hasShareIntent,
  silentDownloadEnabled,
}: {
  parseLoading: boolean;
  autoParsing: boolean;
  shareAutoParsePending: boolean;
  incomingUrlPresent: boolean;
  hasShareIntent: boolean;
  silentDownloadEnabled: boolean;
}) => {
  const shareBusy =
    !silentDownloadEnabled &&
    (shareAutoParsePending || incomingUrlPresent || hasShareIntent);

  return {
    parseBusy: parseLoading || autoParsing || shareBusy,
    loadingText:
      autoParsing || (shareAutoParsePending && !silentDownloadEnabled)
        ? '自动解析中...'
        : '解析中...',
  };
};
