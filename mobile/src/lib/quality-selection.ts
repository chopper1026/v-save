interface ResolvePreferredQualityInput {
  qualityOptions: string[];
  currentQuality?: string | null;
  autoSelectHighest: boolean;
}

interface BuildQualitySelectionKeyInput {
  originalVideoUrl?: string | null;
  qualityRefreshKey?: string | null;
  runtimeTraceId?: string | null;
  format: string;
}

export const buildQualitySelectionKey = (
  input: BuildQualitySelectionKeyInput,
): string =>
  [
    String(input.runtimeTraceId || '').trim(),
    String(input.originalVideoUrl || '').trim(),
    String(input.qualityRefreshKey || '').trim(),
    String(input.format || '').trim(),
  ].join('|');

export const resolvePreferredQuality = (
  input: ResolvePreferredQualityInput,
): string => {
  const qualityOptions = Array.from(
    new Set(
      (input.qualityOptions || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
  if (qualityOptions.length === 0) {
    return '';
  }

  const currentQuality = String(input.currentQuality || '').trim();
  if (input.autoSelectHighest) {
    return qualityOptions[0];
  }

  if (!currentQuality) {
    return qualityOptions[0];
  }

  return qualityOptions.includes(currentQuality)
    ? currentQuality
    : qualityOptions[0];
};
