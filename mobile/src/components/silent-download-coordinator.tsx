import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { logSilentDownloadDebug } from '@/lib/silent-download-debug';
import { isNativeSilentDownloadEngineAvailable } from '@/lib/native-silent-download-bridge';
import {
  resolveSilentDownloadCoordinatorAction,
  shouldRetryFailedSilentDownloadTask,
} from '@/lib/silent-download-runtime-policy';
import { useAuthStore } from '@/store/auth-store';
import { useSilentDownloadQueueStore } from '@/store/silent-download-queue-store';
import { runSilentDownloadTask } from '@/lib/silent-download-worker';

export function SilentDownloadCoordinator() {
  if (isNativeSilentDownloadEngineAvailable()) {
    return null;
  }

  const token = useAuthStore((state) => state.token);
  const queueHydrated = useSilentDownloadQueueStore((state) => state.hydrated);
  const tasks = useSilentDownloadQueueStore((state) => state.tasks);
  const pausedReason = useSilentDownloadQueueStore((state) => state.pausedReason);
  const patchTask = useSilentDownloadQueueStore((state) => state.patchTask);
  const requeueFailedOnce = useSilentDownloadQueueStore((state) => state.requeueFailedOnce);
  const pauseQueue = useSilentDownloadQueueStore((state) => state.pauseQueue);
  const recoverInterruptedTasks = useSilentDownloadQueueStore((state) => state.recoverInterruptedTasks);
  const runningTaskIdRef = useRef<string | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const action = resolveSilentDownloadCoordinatorAction({
      queueHydrated,
      token,
      appState,
      pausedReason,
      hasRunningTask: Boolean(runningTaskIdRef.current),
      tasks,
    });
    if (action.type !== 'recover') {
      return;
    }

    logSilentDownloadDebug('coordinator:recover-interrupted-tasks', {
      taskIds: action.taskIds,
    });
    recoverInterruptedTasks();
  }, [appState, pausedReason, queueHydrated, recoverInterruptedTasks, tasks, token]);

  useEffect(() => {
    const action = resolveSilentDownloadCoordinatorAction({
      queueHydrated,
      token,
      appState,
      pausedReason,
      hasRunningTask: Boolean(runningTaskIdRef.current),
      tasks,
    });
    if (action.type !== 'start') {
      return;
    }

    const nextTask = action.task;
    const resolvedToken = String(token || '').trim();
    if (!resolvedToken) {
      return;
    }

    runningTaskIdRef.current = nextTask.id;
    logSilentDownloadDebug('coordinator:start-task', {
      taskId: nextTask.id,
      sourceUrl: nextTask.sourceUrl,
      retryCount: nextTask.retryCount || 0,
    });

    void (async () => {
      try {
        patchTask(nextTask.id, {
          status: 'parsing',
          progress: 1,
          errorMessage: '',
        });
        await runSilentDownloadTask({
          sourceUrl: nextTask.sourceUrl,
          token: resolvedToken,
          onProgress: (progress) => {
            logSilentDownloadDebug('coordinator:progress', {
              taskId: nextTask.id,
              ...progress,
            });
            patchTask(nextTask.id, {
              ...progress,
            });
          },
        });
        patchTask(nextTask.id, {
          status: 'completed',
          progress: 100,
          finishedAt: Date.now(),
        });
        logSilentDownloadDebug('coordinator:completed-task', {
          taskId: nextTask.id,
        });
      } catch (error) {
        const shouldPauseQueue = Boolean((error as any)?.pauseQueue);
        const pauseReasonValue = String((error as any)?.pauseReason || '').trim();
        const pauseMessageValue = String((error as any)?.pauseMessage || '').trim();
        logSilentDownloadDebug('coordinator:failed-task', {
          taskId: nextTask.id,
          error: error instanceof Error ? error.message : String(error),
          pauseReason: pauseReasonValue || undefined,
        });
        patchTask(nextTask.id, {
          status: 'failed',
          progress: 0,
          errorMessage: error instanceof Error ? error.message : '静默下载失败',
          finishedAt: Date.now(),
        });
        if (shouldPauseQueue && pauseReasonValue && pauseMessageValue) {
          pauseQueue(pauseReasonValue, pauseMessageValue);
        }
        const remainingQueuedTasks = useSilentDownloadQueueStore
          .getState()
          .tasks.filter((task) => task.id !== nextTask.id && task.status === 'queued');
        const latestState = useSilentDownloadQueueStore
          .getState()
          .tasks.find((task) => task.id === nextTask.id);
        if (shouldRetryFailedSilentDownloadTask({
          shouldPauseQueue,
          remainingQueuedTaskCount: remainingQueuedTasks.length,
          retryCount: latestState?.retryCount || 0,
        })) {
          logSilentDownloadDebug('coordinator:retry-failed-task-once', {
            taskId: nextTask.id,
          });
          requeueFailedOnce(nextTask.id);
        }
      } finally {
        runningTaskIdRef.current = null;
      }
    })();
  }, [
    appState,
    patchTask,
    pauseQueue,
    pausedReason,
    queueHydrated,
    requeueFailedOnce,
    tasks,
    token,
  ]);

  return null;
}
