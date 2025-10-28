export type MineruErrorCode =
  | 'MINERU_HTTP_ERROR'
  | 'MINERU_TIMEOUT'
  | 'MINERU_INVALID_RESPONSE'
  | 'MINERU_INVALID_ARGUMENT'
  | 'MINERU_NO_TASK_ID'
  | 'MINERU_NO_RESULT_URL'
  | 'MINERU_TASK_FAILED'
  | 'MINERU_ARCHIVE_ERROR'
  | 'MINERU_EMPTY_ANALYSIS';

export interface MineruErrorContext {
  endpoint?: string;
  status?: number;
  requestId?: string;
  responseBody?: string;
  hint?: string;
}

export class MineruClientError extends Error {
  readonly code: MineruErrorCode;
  readonly context?: MineruErrorContext;

  constructor({
    message,
    code,
    context,
    cause,
  }: {
    message: string;
    code: MineruErrorCode;
    context?: MineruErrorContext;
    cause?: unknown;
  }) {
    super(message, { cause });
    this.name = 'MineruClientError';
    this.code = code;
    this.context = context;
  }
}

export class MineruHttpError extends MineruClientError {
  readonly status: number;
  readonly endpoint: string;
  readonly hint?: string;

  constructor({
    message,
    status,
    endpoint,
    requestId,
    responseBody,
    hint,
    code = status === 504 ? 'MINERU_TIMEOUT' : 'MINERU_HTTP_ERROR',
    cause,
  }: {
    message: string;
    status: number;
    endpoint: string;
    requestId?: string;
    responseBody?: string;
    hint?: string;
    code?: MineruErrorCode;
    cause?: unknown;
  }) {
    super({
      message,
      code,
      context: { endpoint, status, requestId, responseBody, hint },
      cause,
    });
    this.name = 'MineruHttpError';
    this.status = status;
    this.endpoint = endpoint;
    this.hint = hint;
  }
}

export function isMineruClientError(error: unknown): error is MineruClientError {
  return error instanceof MineruClientError || error instanceof MineruHttpError;
}
