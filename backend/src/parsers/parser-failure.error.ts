import { VideoInfo } from './base.interface';

export type ParserFailureCategory =
  | 'invalid_input'
  | 'unsupported_platform'
  | 'risk_control'
  | 'video_unavailable'
  | 'upstream'
  | 'parse_failed';

interface ParserFailureErrorOptions {
  code: string;
  message: string;
  category: ParserFailureCategory;
  retryable: boolean;
  platform?: VideoInfo['platform'];
  details?: Record<string, any>;
}

export class ParserFailureError extends Error {
  readonly code: string;
  readonly category: ParserFailureCategory;
  readonly retryable: boolean;
  readonly platform?: VideoInfo['platform'];
  readonly details?: Record<string, any>;

  constructor(options: ParserFailureErrorOptions) {
    super(options.message);
    this.name = 'ParserFailureError';
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable;
    this.platform = options.platform;
    this.details = options.details;
  }

  toResponseBody(): Record<string, any> {
    return {
      code: this.code,
      message: this.message,
      category: this.category,
      retryable: this.retryable,
      platform: this.platform,
      details: this.details,
    };
  }
}

export const isParserFailureError = (
  error: unknown,
): error is ParserFailureError => error instanceof ParserFailureError;
