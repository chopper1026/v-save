import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextSnapshot {
  requestId: string;
  method?: string;
  path?: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContextSnapshot>();

export const runWithRequestContext = <T>(
  context: RequestContextSnapshot,
  callback: () => T,
): T => requestContextStorage.run(context, callback);

export const getRequestContext = (): RequestContextSnapshot | undefined =>
  requestContextStorage.getStore();
