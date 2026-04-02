interface SilentDownloadRuntimeTaskLike {
  id?: string;
  status?: string;
  retryCount?: number;
}

export type SilentDownloadCoordinatorAction<T extends SilentDownloadRuntimeTaskLike> =
  | {
      type: 'idle';
    }
  | {
      type: 'recover';
      taskIds: string[];
    }
  | {
      type: 'start';
      task: T;
    };

const INTERRUPTED_STATUSES = new Set(['parsing', 'downloading', 'saving']);

const getInterruptedSilentDownloadTaskIds = (
  tasks: SilentDownloadRuntimeTaskLike[],
): string[] => {
  const list = Array.isArray(tasks) ? tasks : [];
  return list
    .filter((task) => INTERRUPTED_STATUSES.has(String(task?.status || '')))
    .map((task) => String(task.id || '').trim())
    .filter(Boolean);
};

const getNextQueuedSilentDownloadTask = <
  T extends SilentDownloadRuntimeTaskLike,
>(
  tasks: T[],
): T | null => {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.find((task) => task.status === 'queued') || null;
};

export const shouldRecoverInterruptedSilentDownloadTasks = (input: {
  queueHydrated: boolean;
  appState: string;
  hasRunningTask: boolean;
  tasks: SilentDownloadRuntimeTaskLike[];
}): boolean => {
  return (
    input.queueHydrated &&
    input.appState === 'active' &&
    !input.hasRunningTask &&
    getInterruptedSilentDownloadTaskIds(input.tasks).length > 0
  );
};

export const shouldStartSilentDownloadTask = (input: {
  queueHydrated: boolean;
  token: string | null | undefined;
  appState: string;
  pausedReason: string | null | undefined;
  hasRunningTask: boolean;
  nextTask: SilentDownloadRuntimeTaskLike | null | undefined;
}): boolean => {
  return (
    input.queueHydrated &&
    Boolean(String(input.token || '').trim()) &&
    input.appState === 'active' &&
    !String(input.pausedReason || '').trim() &&
    !input.hasRunningTask &&
    Boolean(input.nextTask)
  );
};

export const shouldRetryFailedSilentDownloadTask = (input: {
  shouldPauseQueue: boolean;
  remainingQueuedTaskCount: number;
  retryCount: number;
}): boolean => {
  return (
    !input.shouldPauseQueue &&
    Math.max(0, Number(input.remainingQueuedTaskCount) || 0) === 0 &&
    Math.max(0, Number(input.retryCount) || 0) < 1
  );
};

export const shouldPersistSilentDownloadQueueSnapshot = (input: {
  queueHydrated: boolean;
  previousSnapshot: string | null;
  nextSnapshot: string;
}): boolean => {
  return input.queueHydrated && input.nextSnapshot !== input.previousSnapshot;
};

export const resolveSilentDownloadCoordinatorAction = <
  T extends SilentDownloadRuntimeTaskLike,
>(
  input: {
    queueHydrated: boolean;
    token: string | null | undefined;
    appState: string;
    pausedReason: string | null | undefined;
    hasRunningTask: boolean;
    tasks: T[];
  },
): SilentDownloadCoordinatorAction<T> => {
  const interruptedTaskIds = getInterruptedSilentDownloadTaskIds(input.tasks);
  if (
    shouldRecoverInterruptedSilentDownloadTasks({
      queueHydrated: input.queueHydrated,
      appState: input.appState,
      hasRunningTask: input.hasRunningTask,
      tasks: input.tasks,
    })
  ) {
    return {
      type: 'recover',
      taskIds: interruptedTaskIds,
    };
  }

  const nextTask = getNextQueuedSilentDownloadTask(input.tasks);
  if (
    shouldStartSilentDownloadTask({
      queueHydrated: input.queueHydrated,
      token: input.token,
      appState: input.appState,
      pausedReason: input.pausedReason,
      hasRunningTask: input.hasRunningTask,
      nextTask,
    })
  ) {
    return {
      type: 'start',
      task: nextTask as T,
    };
  }

  return {
    type: 'idle',
  };
};
