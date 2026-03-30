export const SCROLL_TO_TOP_VISIBILITY_OFFSET = 280;
export const SCROLL_TO_TOP_LOCK_RELEASE_OFFSET = 24;

export const shouldShowScrollToTopButton = (
  offsetY: number,
  threshold = SCROLL_TO_TOP_VISIBILITY_OFFSET,
  lockActive = false,
): boolean => !lockActive && Number(offsetY) > threshold;

export const shouldReleaseScrollToTopLock = (
  offsetY: number,
  releaseOffset = SCROLL_TO_TOP_LOCK_RELEASE_OFFSET,
): boolean => Number(offsetY) <= releaseOffset;

export const resolveActiveTabSegment = (segments: readonly string[]): string | null => {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment && !segment.startsWith('(')) {
      return segment;
    }
  }
  return null;
};
