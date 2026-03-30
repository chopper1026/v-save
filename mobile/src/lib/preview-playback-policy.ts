export type PreviewPlayerStatus = 'idle' | 'loading' | 'readyToPlay' | 'error';

export interface ResolvePreviewPlaybackActionInput {
  status: PreviewPlayerStatus;
  candidateIndex: number;
  candidateCount: number;
  hadReady: boolean;
  phaseStartedAtMs: number;
  nowMs: number;
  startupTimeoutMs?: number;
  bufferingTimeoutMs?: number;
}

export type PreviewPlaybackAction =
  | { type: 'wait' }
  | { type: 'ready' }
  | { type: 'advance'; reason: 'startup_timeout' | 'buffering_timeout' | 'player_error' }
  | { type: 'fail'; reason: 'startup_timeout' | 'buffering_timeout' | 'player_error' };

export const DEFAULT_PREVIEW_STARTUP_TIMEOUT_MS = 3200;
export const DEFAULT_PREVIEW_BUFFERING_TIMEOUT_MS = 1800;

export const resolvePreviewPlaybackAction = (
  input: ResolvePreviewPlaybackActionInput,
): PreviewPlaybackAction => {
  const {
    status,
    candidateIndex,
    candidateCount,
    hadReady,
    phaseStartedAtMs,
    nowMs,
    startupTimeoutMs = DEFAULT_PREVIEW_STARTUP_TIMEOUT_MS,
    bufferingTimeoutMs = DEFAULT_PREVIEW_BUFFERING_TIMEOUT_MS,
  } = input;

  if (status === 'readyToPlay') {
    return { type: 'ready' };
  }

  const isLastCandidate = candidateIndex >= Math.max(0, candidateCount - 1);
  if (status === 'error') {
    return isLastCandidate
      ? { type: 'fail', reason: 'player_error' }
      : { type: 'advance', reason: 'player_error' };
  }

  if (status !== 'loading' && status !== 'idle') {
    return { type: 'wait' };
  }

  const elapsedMs = Math.max(0, Number(nowMs || 0) - Number(phaseStartedAtMs || 0));
  const timedOut = hadReady
    ? elapsedMs >= bufferingTimeoutMs
    : elapsedMs >= startupTimeoutMs;

  if (!timedOut) {
    return { type: 'wait' };
  }

  const reason = hadReady ? 'buffering_timeout' : 'startup_timeout';
  return isLastCandidate ? { type: 'fail', reason } : { type: 'advance', reason };
};
