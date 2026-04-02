import { create } from 'zustand';
import type { Platform } from '@/types/api';
import { getSilentDownloadFinishedOrderValue } from '@/lib/silent-download-history-order';
import { buildShareAutoParseKey, extractSupportedVideoUrl } from '@/lib/link';
import type { PersistedSilentDownloadQueueState } from './silent-download-persistence-snapshot';

export type SilentDownloadTaskStatus =
  | 'queued'
  | 'preparing'
  | 'parsing'
  | 'downloading'
  | 'saving'
  | 'completed'
  | 'failed';

export interface SilentDownloadTask {
  id: string;
  sourceUrl: string;
  dedupeKey: string;
  status: SilentDownloadTaskStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  title?: string;
  platform?: Platform;
  quality?: string;
  runtimeTraceId?: string;
  errorMessage?: string;
  retryCount?: number;
}

type SilentDownloadTaskPatch = Partial<Omit<SilentDownloadTask, 'id' | 'sourceUrl' | 'dedupeKey' | 'createdAt'>>;

type ReduceAction =
  | { type: 'enqueue'; task: SilentDownloadTask }
  | { type: 'patch'; taskId: string; patch: SilentDownloadTaskPatch }
  | { type: 'remove'; taskId: string }
  | { type: 'clearFinished' }
  | { type: 'requeue-failed-once'; taskId: string }
  | { type: 'hydrate'; tasks: SilentDownloadTask[] };

const ACTIVE_STATUSES = new Set<SilentDownloadTaskStatus>([
  'queued',
  'preparing',
  'parsing',
  'downloading',
  'saving',
]);
const FINISHED_STATUSES = new Set<SilentDownloadTaskStatus>([
  'completed',
  'failed',
]);

export const RUNTIME_SILENT_DOWNLOAD_FINISHED_LIMIT = 20;

const normalizeTaskDedupeKey = (raw: string): string => {
  const extracted = extractSupportedVideoUrl(raw || '');
  if (!extracted) {
    return '';
  }
  return buildShareAutoParseKey(extracted) || extracted.trim().toLowerCase();
};

const buildTaskId = (): string => {
  return `silent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

export const createSilentDownloadTask = (sourceUrl: string): SilentDownloadTask => {
  const extracted = extractSupportedVideoUrl(sourceUrl || '') || String(sourceUrl || '').trim();
  const now = Date.now();
  return {
    id: buildTaskId(),
    sourceUrl: extracted,
    dedupeKey: normalizeTaskDedupeKey(extracted),
    status: 'queued',
    progress: 0,
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
  };
};

export const recoverInterruptedSilentDownloadTasks = (
  tasks: SilentDownloadTask[]
): SilentDownloadTask[] => {
  return tasks.map((task) => {
    if (
      task.status === 'preparing' ||
      task.status === 'parsing' ||
      task.status === 'downloading' ||
      task.status === 'saving'
    ) {
      return {
        ...task,
        status: 'queued',
        progress: 0,
        updatedAt: Date.now(),
      };
    }
    return task;
  });
};

export const getLatestFinishedSilentDownloadTasks = (
  tasks: SilentDownloadTask[],
  limit = 10
): SilentDownloadTask[] => {
  return tasks
    .filter((task) => task.status === 'completed' || task.status === 'failed')
    .slice()
    .sort(
      (left, right) =>
        getSilentDownloadFinishedOrderValue(right) - getSilentDownloadFinishedOrderValue(left)
    )
    .slice(0, Math.max(1, limit));
};

export const trimRuntimeSilentDownloadTasks = (
  tasks: SilentDownloadTask[],
  finishedLimit = RUNTIME_SILENT_DOWNLOAD_FINISHED_LIMIT
): SilentDownloadTask[] => {
  const list = Array.isArray(tasks) ? tasks : [];
  const normalizedLimit = Math.max(1, finishedLimit);
  const finishedTasks = list.filter((task) => FINISHED_STATUSES.has(task.status));
  if (finishedTasks.length <= normalizedLimit) {
    return list;
  }

  const retainedFinishedIds = new Set(
    finishedTasks
      .slice()
      .sort(
        (left, right) =>
          getSilentDownloadFinishedOrderValue(right) - getSilentDownloadFinishedOrderValue(left)
      )
      .slice(0, normalizedLimit)
      .map((task) => task.id)
  );

  return list.filter(
    (task) => ACTIVE_STATUSES.has(task.status) || retainedFinishedIds.has(task.id)
  );
};

export const getSilentDownloadTaskSummary = (tasks: SilentDownloadTask[]) => {
  const inFlight = tasks.filter((task) =>
    task.status === 'queued' ||
    task.status === 'preparing' ||
    task.status === 'parsing' ||
    task.status === 'downloading' ||
    task.status === 'saving'
  ).length;
  const finished = tasks.filter((task) =>
    task.status === 'completed' || task.status === 'failed'
  ).length;

  return {
    total: tasks.length,
    inFlight,
    finished,
  };
};

export const reduceSilentDownloadTasks = (
  tasks: SilentDownloadTask[],
  action: ReduceAction
): SilentDownloadTask[] => {
  switch (action.type) {
    case 'enqueue': {
      const nextTask = action.task;
      if (
        nextTask.dedupeKey &&
        tasks.some(
          (task) => task.dedupeKey === nextTask.dedupeKey && ACTIVE_STATUSES.has(task.status)
        )
      ) {
        return tasks;
      }
      return trimRuntimeSilentDownloadTasks([...tasks, nextTask]);
    }
    case 'patch':
      return trimRuntimeSilentDownloadTasks(
        tasks.map((task) => {
          if (task.id !== action.taskId) {
            return task;
          }
          const nextStatus = action.patch.status || task.status;
          const nextFinishedAt =
            nextStatus === 'completed' || nextStatus === 'failed'
              ? action.patch.finishedAt ?? Date.now()
              : action.patch.finishedAt;
          const nextStartedAt =
            task.startedAt ||
            (nextStatus !== 'queued'
              ? action.patch.startedAt ?? Date.now()
              : action.patch.startedAt);
          return {
            ...task,
            ...action.patch,
            startedAt: nextStartedAt,
            finishedAt: nextFinishedAt,
            updatedAt: Date.now(),
          };
        })
      );
    case 'remove':
      return trimRuntimeSilentDownloadTasks(tasks.filter((task) => task.id !== action.taskId));
    case 'clearFinished':
      return trimRuntimeSilentDownloadTasks(tasks.filter((task) => ACTIVE_STATUSES.has(task.status)));
    case 'requeue-failed-once':
      return trimRuntimeSilentDownloadTasks(
        tasks.map((task) => {
          if (
            task.id !== action.taskId ||
            task.status !== 'failed' ||
            (task.retryCount || 0) >= 1
          ) {
            return task;
          }
          return {
            ...task,
            status: 'queued',
            progress: 0,
            errorMessage: '',
            retryCount: (task.retryCount || 0) + 1,
            updatedAt: Date.now(),
            finishedAt: undefined,
          };
        })
      );
    case 'hydrate':
      return trimRuntimeSilentDownloadTasks(Array.isArray(action.tasks) ? action.tasks : []);
    default:
      return tasks;
  }
};

interface SilentDownloadQueueState {
  tasks: SilentDownloadTask[];
  hydrated: boolean;
  pausedReason: string | null;
  pauseMessage: string | null;
  enqueueSourceUrl: (sourceUrl: string) => { accepted: boolean; task: SilentDownloadTask | null };
  patchTask: (taskId: string, patch: SilentDownloadTaskPatch) => void;
  removeTask: (taskId: string) => void;
  clearFinished: () => void;
  requeueFailedOnce: (taskId: string) => void;
  pauseQueue: (reason: string, message: string) => void;
  resumeQueue: () => void;
  hydratePersistenceState: (state: PersistedSilentDownloadQueueState) => void;
  setHydrated: (hydrated: boolean) => void;
  recoverInterruptedTasks: () => void;
}

export const useSilentDownloadQueueStore = create<SilentDownloadQueueState>()((set, get) => ({
  tasks: [],
  hydrated: false,
  pausedReason: null,
  pauseMessage: null,
  enqueueSourceUrl: (sourceUrl) => {
    const task = createSilentDownloadTask(sourceUrl);
    const nextTasks = reduceSilentDownloadTasks(get().tasks, {
      type: 'enqueue',
      task,
    });
    const accepted = nextTasks.length !== get().tasks.length;
    if (accepted) {
      set({ tasks: nextTasks });
      return { accepted: true, task };
    }
    return { accepted: false, task: null };
  },
  patchTask: (taskId, patch) =>
    set((state) => ({
      tasks: reduceSilentDownloadTasks(state.tasks, {
        type: 'patch',
        taskId,
        patch,
      }),
    })),
  removeTask: (taskId) =>
    set((state) => ({
      tasks: reduceSilentDownloadTasks(state.tasks, {
        type: 'remove',
        taskId,
      }),
    })),
  clearFinished: () =>
    set((state) => ({
      tasks: reduceSilentDownloadTasks(state.tasks, {
        type: 'clearFinished',
      }),
    })),
  requeueFailedOnce: (taskId) =>
    set((state) => ({
      tasks: reduceSilentDownloadTasks(state.tasks, {
        type: 'requeue-failed-once',
        taskId,
      }),
    })),
  pauseQueue: (reason, message) =>
    set({
      pausedReason: String(reason || '').trim() || 'unknown',
      pauseMessage: String(message || '').trim() || '静默下载队列已暂停',
    }),
  resumeQueue: () =>
    set({
      pausedReason: null,
      pauseMessage: null,
    }),
  hydratePersistenceState: (state) =>
    set({
      tasks: reduceSilentDownloadTasks([], {
        type: 'hydrate',
        tasks: Array.isArray(state?.tasks) ? state.tasks : [],
      }),
      pausedReason: String(state?.pausedReason || '').trim() || null,
      pauseMessage: String(state?.pauseMessage || '').trim() || null,
    }),
  setHydrated: (hydrated) => set({ hydrated }),
  recoverInterruptedTasks: () =>
    set((state) => ({
      tasks: trimRuntimeSilentDownloadTasks(recoverInterruptedSilentDownloadTasks(state.tasks)),
    })),
}));
