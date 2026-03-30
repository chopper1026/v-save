import { Injectable } from '@nestjs/common';
import {
  RequestContextSnapshot,
  getRequestContext,
  runWithRequestContext,
} from './request-context.storage';

@Injectable()
export class RequestContextService {
  run<T>(context: RequestContextSnapshot, callback: () => T): T {
    return runWithRequestContext(context, callback);
  }

  getSnapshot(): RequestContextSnapshot | undefined {
    return getRequestContext();
  }

  getRequestId(): string | undefined {
    return this.getSnapshot()?.requestId;
  }
}
