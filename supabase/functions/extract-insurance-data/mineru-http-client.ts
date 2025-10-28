import { MineruClientError, MineruHttpError } from './mineru-errors.ts';

const DEFAULT_MINERU_BASE_URL = 'https://mineru.net/api/v4' as const;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const BODY_PREVIEW_LIMIT = 512;

type FetchImpl = typeof fetch;

export interface MineruHttpClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  organizationId?: string;
  defaultTimeoutMs?: number;
  maxRetries?: number;
}

export interface MineruHttpRequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  timeoutMs?: number;
  organizationId?: string;
  requestId?: string;
  includeAuthHeader?: boolean;
}

export interface MineruHttpResponse<T> {
  data: T;
  status: number;
  headers: Headers;
  requestId: string;
  endpoint: string;
  rawBody?: string;
}

export function sanitizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function pickBaseUrl(candidate?: string): string {
  if (!candidate) {
    return DEFAULT_MINERU_BASE_URL;
  }

  return sanitizeBaseUrl(candidate);
}

export class MineruHttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImpl;
  private readonly organizationId?: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxRetries: number;

  constructor({
    apiKey,
    baseUrl,
    fetchImpl = fetch,
    organizationId,
    defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = MAX_RETRIES,
  }: MineruHttpClientOptions) {
    this.apiKey = apiKey;
    this.baseUrl = pickBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
    this.organizationId = organizationId?.trim() || undefined;
    this.defaultTimeoutMs = Math.max(1_000, defaultTimeoutMs);
    this.maxRetries = Math.max(0, maxRetries);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async requestJson<T>(pathOrUrl: string, options: MineruHttpRequestOptions = {}): Promise<MineruHttpResponse<T>> {
    return await this.execute(pathOrUrl, options, async (response) => {
      const text = await response.text();
      const rawBody = text || undefined;
      const preview = createBodyPreview(rawBody);

      if (!rawBody) {
        return { data: undefined as T, rawBody, bodyPreview: preview };
      }

      try {
        const parsed = JSON.parse(rawBody) as T;
        return { data: parsed, rawBody, bodyPreview: preview };
      } catch (error) {
        throw new MineruClientError({
          message: 'Mineru response is not valid JSON',
          code: 'MINERU_INVALID_RESPONSE',
          context: {
            endpoint: response.url,
            status: response.status,
            requestId: options.requestId,
            responseBody: preview,
          },
          cause: error,
        });
      }
    });
  }

  async requestArrayBuffer(
    pathOrUrl: string,
    options: MineruHttpRequestOptions = {},
  ): Promise<MineruHttpResponse<ArrayBuffer>> {
    return await this.execute(pathOrUrl, options, async (response) => {
      const buffer = await response.arrayBuffer();
      return { data: buffer, bodyPreview: `[binary ${buffer.byteLength} bytes]` };
    });
  }

  private async execute<T>(
    pathOrUrl: string,
    options: MineruHttpRequestOptions,
    parser: (response: Response) => Promise<{ data: T; rawBody?: string; bodyPreview?: string }>,
  ): Promise<MineruHttpResponse<T>> {
    const requestId = options.requestId ?? generateRequestId();
    const endpoint = this.buildUrl(pathOrUrl);
    const headers = this.buildHeaders(options, requestId);
    const timeoutMs = Math.max(1_000, options.timeoutMs ?? this.defaultTimeoutMs);

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= this.maxRetries) {
      const attemptStart = Date.now();
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await this.fetchImpl(endpoint, {
          method: options.method ?? 'GET',
          headers,
          body: options.body ?? undefined,
          signal: controller.signal,
        });

        const durationMs = Date.now() - attemptStart;
        
        if (!response.ok) {
          const responseText = await safeReadBody(response);
          const preview = createBodyPreview(responseText);

          this.logResponse({
            requestId,
            endpoint: response.url,
            method: options.method ?? 'GET',
            status: response.status,
            durationMs,
            bodyPreview: preview,
          });

          const error = new MineruHttpError({
            message: `Mineru request failed (${response.status})`,
            status: response.status,
            endpoint: response.url,
            requestId,
            responseBody: preview,
            hint: response.headers.get('x-error-code') ?? undefined,
          });

          if (this.shouldRetry(response.status) && attempt < this.maxRetries) {
            await this.delayWithBackoff(attempt);
            attempt += 1;
            continue;
          }

          throw error;
        }

        const { data, rawBody, bodyPreview } = await parser(response);

        this.logResponse({
          requestId,
          endpoint: response.url,
          method: options.method ?? 'GET',
          status: response.status,
          durationMs,
          bodyPreview,
        });

        return {
          data,
          status: response.status,
          headers: response.headers,
          requestId,
          endpoint: response.url,
          rawBody,
        };
      } catch (error) {
        const durationMs = Date.now() - attemptStart;
        lastError = error instanceof Error ? error : new Error(String(error));

        if (isAbortError(error)) {
          this.logResponse({
            requestId,
            endpoint,
            method: options.method ?? 'GET',
            status: 0,
            durationMs,
            bodyPreview: '[timeout]',
          });

          const timeoutError = new MineruHttpError({
            message: `Mineru request timed out after ${timeoutMs}ms`,
            status: 504,
            endpoint,
            requestId,
            code: 'MINERU_TIMEOUT',
            cause: error,
          });

          if (attempt < this.maxRetries) {
            await this.delayWithBackoff(attempt);
            attempt += 1;
            continue;
          }

          throw timeoutError;
        }

        if (error instanceof MineruHttpError) {
          throw error;
        }

        this.logResponse({
          requestId,
          endpoint,
          method: options.method ?? 'GET',
          status: 0,
          durationMs,
          bodyPreview: `[${error instanceof Error ? error.name : 'Error'}]`,
        });

        if (attempt < this.maxRetries && this.shouldRetry(500)) {
          await this.delayWithBackoff(attempt);
          attempt += 1;
          continue;
        }

        throw new MineruClientError({
          message: 'Mineru request failed before receiving a response',
          code: 'MINERU_HTTP_ERROR',
          context: { endpoint, requestId },
          cause: error,
        });
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    throw lastError ?? new Error('Mineru request failed');
  }

  private buildHeaders(options: MineruHttpRequestOptions, requestId: string): Headers {
    const headers = new Headers(options.headers ?? {});

    if (options.includeAuthHeader !== false) {
      headers.set('Authorization', `Bearer ${this.apiKey}`);
    }

    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json');
    }

    const organizationId = options.organizationId?.trim() || this.organizationId;
    if (organizationId) {
      headers.set('X-Organization-Id', organizationId);
    }

    headers.set('X-Request-Id', requestId);

    return headers;
  }

  private buildUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }

    const normalizedPath = pathOrUrl.replace(/^\/+/, '');
    if (!normalizedPath) {
      return this.baseUrl;
    }

    return `${this.baseUrl}/${normalizedPath}`;
  }

  private shouldRetry(status: number): boolean {
    return status >= 500 && status < 600;
  }

  private async delayWithBackoff(attempt: number): Promise<void> {
    const baseDelay = BASE_BACKOFF_MS * Math.pow(2, attempt);
    const jitter = Math.random() * BASE_BACKOFF_MS;
    const delay = baseDelay + jitter;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private logResponse({
    requestId,
    endpoint,
    method,
    status,
    durationMs,
    bodyPreview,
  }: {
    requestId?: string;
    endpoint: string;
    method: string;
    status: number;
    durationMs?: number;
    bodyPreview?: string;
  }) {
    const payload = {
      requestId,
      endpoint,
      method,
      status,
      durationMs,
      bodyPreview,
    };

    console.debug('MinerU HTTP', payload);
  }

}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `mineru-${Math.random().toString(16).slice(2, 10)}-${Date.now().toString(16)}`;
}

function createBodyPreview(body?: string): string | undefined {
  if (!body) {
    return undefined;
  }

  if (body.length <= BODY_PREVIEW_LIMIT) {
    return body;
  }

  return `${body.slice(0, BODY_PREVIEW_LIMIT)}…`;
}

async function safeReadBody(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error
      ? error.name === 'AbortError'
      : false;
}

export { DEFAULT_MINERU_BASE_URL };
