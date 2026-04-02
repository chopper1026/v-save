import { getSilentDownloadFinishedOrderValue } from '@/lib/silent-download-history-order';
import type { SilentDownloadTask } from './silent-download-queue-store';

export const PERSISTED_SILENT_DOWNLOAD_FINISHED_LIMIT = 20;

export interface PersistedSilentDownloadQueueState {
  tasks: SilentDownloadTask[];
  pausedReason: string | null;
  pauseMessage: string | null;
}

const INTERRUPTED_STATUSES = new Set(['parsing', 'downloading', 'saving']);
const FINISHED_STATUSES = new Set(['completed', 'failed']);

const stripTransientFields = (task: SilentDownloadTask): SilentDownloadTask => ({
  ...task,
  runtimeTraceId: undefined,
});

const toRecoverableQueuedTask = (task: SilentDownloadTask): SilentDownloadTask => {
  const {
    startedAt: _startedAt,
    finishedAt: _finishedAt,
    errorMessage: _errorMessage,
    ...rest
  } = stripTransientFields(task);

  return {
    ...rest,
    status: 'queued',
    progress: 0,
    updatedAt: task.createdAt,
  };
};

export const buildPersistedSilentDownloadTasks = (
  tasks: SilentDownloadTask[],
): SilentDownloadTask[] => {
  const list = Array.isArray(tasks) ? tasks : [];

  const recoverableTasks = list
    .filter((task) => !FINISHED_STATUSES.has(task.status))
    .map((task) =>
      INTERRUPTED_STATUSES.has(task.status)
        ? toRecoverableQueuedTask(task)
        : stripTransientFields(task),
    );

  const finishedTasks = list
    .filter((task) => FINISHED_STATUSES.has(task.status))
    .slice()
    .sort(
      (left, right) =>
        getSilentDownloadFinishedOrderValue(right) - getSilentDownloadFinishedOrderValue(left)
    )
    .slice(0, PERSISTED_SILENT_DOWNLOAD_FINISHED_LIMIT)
    .map(stripTransientFields);

  return [...recoverableTasks, ...finishedTasks];
};

export const buildPersistedSilentDownloadQueueState = (input: {
  tasks: SilentDownloadTask[];
  pausedReason?: string | null;
  pauseMessage?: string | null;
}): PersistedSilentDownloadQueueState => {
  return {
    tasks: buildPersistedSilentDownloadTasks(input.tasks),
    pausedReason: String(input.pausedReason || '').trim() || null,
    pauseMessage: String(input.pauseMessage || '').trim() || null,
  };
};

export const normalizePersistedSilentDownloadQueueState = (
  input: Partial<PersistedSilentDownloadQueueState> | null | undefined,
): PersistedSilentDownloadQueueState => {
  return buildPersistedSilentDownloadQueueState({
    tasks: Array.isArray(input?.tasks) ? input.tasks : [],
    pausedReason: input?.pausedReason || null,
    pauseMessage: input?.pauseMessage || null,
  });
};
