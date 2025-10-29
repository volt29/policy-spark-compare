import {
  ParsedSection,
  SectionSource,
  SECTION_KEYWORD_MAP,
  SectionType,
} from './classifier.ts';
import { MineruClientError, MineruHttpError } from './mineru-errors.ts';
import { MineruHttpClient, MineruHttpResponse } from './mineru-http-client.ts';

const DEFAULT_POLL_INTERVAL_MS = 2500;
const MIN_POLL_INTERVAL_MS = 250;
const DEFAULT_POLL_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_CREATE_TASK_TIMEOUT_MS = 45_000;
const MAX_CREATE_TASK_TIMEOUT_MS = 2 * 60 * 1000;

export interface MineruBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MineruBlock {
  id?: string;
  type: string;
  text?: string;
  confidence?: number;
  headingLevel?: number;
  boundingBox?: MineruBoundingBox;
  children?: MineruBlock[];
  metadata?: Record<string, unknown>;
}

export interface MineruPage {
  pageNumber: number;
  text: string;
  width?: number;
  height?: number;
  blocks?: MineruBlock[];
}

export interface MineruStructuralSummaryPage {
  pageNumber: number;
  blockCount: number;
  headings?: string[];
  keywords?: string[];
}

export interface MineruStructuralSummary {
  confidence?: number;
  pages: MineruStructuralSummaryPage[];
}

export interface MineruAnalyzeDocumentOptions {
  signedUrl: string;
  documentId?: string;
  organizationId?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  enableOcr?: boolean;
  enableTable?: boolean;
  enableFormula?: boolean;
}

export interface MineruAnalyzeDocumentResult {
  pages: MineruPage[];
  text: string;
  structureSummary: MineruStructuralSummary | null;
}

export interface MineruSegmentationResult {
  sections: ParsedSection[];
  sources: SectionSource[];
}

type ZipEntry = {
  name: string;
  dir: boolean;
  async(type: 'string'): Promise<string>;
};

type MineruExtractTaskStatus =
  | 'pending'
  | 'processing'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'completed'
  | 'success'
  | 'done'
  | 'failed'
  | 'error'
  | 'cancelled'
  | 'canceled';

interface MineruExtractTaskError {
  code?: string;
  message?: string;
  err_msg?: string;
}

interface MineruExtractTaskPayload {
  task_id?: string;
  taskId?: string;
  id?: string;
  task_identifier?: string;
  taskIdentifier?: string;
  task_uuid?: string;
  taskUuid?: string;
  uuid?: string;
  state?: MineruExtractTaskStatus | string;
  status?: MineruExtractTaskStatus | string;
  full_zip_url?: string;
  fullZipUrl?: string;
  result?: {
    full_zip_url?: string;
    fullZipUrl?: string;
    [key: string]: unknown;
  } | null;
  extract_result?:
    | {
      state?: MineruExtractTaskStatus | string;
      status?: MineruExtractTaskStatus | string;
      err_msg?: string | null;
      error?: MineruExtractTaskError | null;
      full_zip_url?: string;
      fullZipUrl?: string;
      result?: Record<string, unknown> | null;
      [key: string]: unknown;
    }
    | Array<{
      state?: MineruExtractTaskStatus | string;
      status?: MineruExtractTaskStatus | string;
      err_msg?: string | null;
      error?: MineruExtractTaskError | null;
      data_id?: string | null;
      full_zip_url?: string;
      fullZipUrl?: string;
      result?: Record<string, unknown> | null;
      [key: string]: unknown;
    }>;
  error?: MineruExtractTaskError | null;
  err_msg?: string | null;
  [key: string]: unknown;
}

interface MineruApiResponse<T> {
  code?: number;
  msg?: string | null;
  trace_id?: string | null;
  data?: T | null;
}

const SUCCESSFUL_TASK_STATES = new Set<string>(['succeeded', 'completed', 'success', 'done']);
const FAILURE_TASK_STATES = new Set<string>(['failed', 'error', 'cancelled', 'canceled', 'timeout']);

type JSZipArchiveFile = {
  name: string;
  dir: boolean;
  async: (type: 'string') => Promise<string>;
};

type JSZipArchive = {
  files: Record<string, JSZipArchiveFile>;
};

type JSZipStatic = {
  loadAsync: (data: ArrayBuffer | Uint8Array | string, options?: unknown) => Promise<JSZipArchive>;
};

let jsZipModulePromise: Promise<JSZipStatic> | null = null;

async function loadJSZip(): Promise<JSZipStatic> {
  if (!jsZipModulePromise) {
    const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
    if (
      typeof Deno !== 'undefined' &&
      !isBun &&
      typeof (Deno as { version?: { deno?: string } }).version?.deno === 'string'
    ) {
      jsZipModulePromise = import('npm:jszip@3.10.1')
        .then((mod: any) => mod?.default ?? mod?.JSZip ?? mod) as Promise<JSZipStatic>;
    } else {
      jsZipModulePromise = (async () => {
        try {
          const mod = await import('jszip');
          return (mod as any)?.default ?? (mod as any)?.JSZip ?? mod;
        } catch (nodeModuleError) {
          try {
            const mod = await import('npm:jszip@3.10.1');
            return (mod as any)?.default ?? (mod as any)?.JSZip ?? mod;
          } catch (npmImportError) {
            const aggregate = new AggregateError(
              [nodeModuleError as Error, npmImportError as Error],
              'Unable to resolve jszip module',
            );
            throw aggregate;
          }
        }
      })() as Promise<JSZipStatic>;
    }
  }

  const module = await jsZipModulePromise;

  if (module && typeof module.loadAsync === 'function') {
    return module;
  }

  throw new Error('Unable to load JSZip module');
}

const KEY_NORMALIZATION_REGEX = /[^a-z0-9]/gi;

const DIRECT_TASK_IDENTIFIER_KEYS = new Set([
  'task',
  'taskid',
  'taskidentifier',
  'taskuuid',
  'taskkey',
  'taskref',
  'taskcode',
  'jobid',
  'jobidentifier',
]);

const INHERITED_IDENTIFIER_KEYS = new Set(['id', 'uuid', 'identifier']);

function normalizeKeySegment(segment: string): string {
  return segment.replace(KEY_NORMALIZATION_REGEX, '').toLowerCase();
}

function pathHasTaskHint(path: string[]): boolean {
  return path.some((segment) => segment.includes('task') || segment.includes('job'));
}

function shouldUseKeyForTaskId(normalizedKey: string, normalizedPath: string[]): boolean {
  if (!normalizedKey) {
    return false;
  }

  if (DIRECT_TASK_IDENTIFIER_KEYS.has(normalizedKey)) {
    return true;
  }

  if (normalizedKey.includes('task') && normalizedKey.includes('id')) {
    return true;
  }

  if (normalizedKey.includes('task') && normalizedKey.includes('identifier')) {
    return true;
  }

  if (normalizedKey.includes('task') && normalizedKey.includes('uuid')) {
    return true;
  }

  if (normalizedKey.includes('job') && normalizedKey.includes('id')) {
    return true;
  }

  if (INHERITED_IDENTIFIER_KEYS.has(normalizedKey)) {
    return pathHasTaskHint(normalizedPath);
  }

  return false;
}

function normalizeTaskId(task: MineruExtractTaskPayload | null | undefined): string | null {
  const extractCandidate = (value: unknown): string | null => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return null;
  };

  const acceptCandidate = (
    candidate: string | null,
    normalizedKey?: string,
    normalizedPath: string[] = [],
  ): string | null => {
    if (!candidate) {
      return null;
    }

    const trimmed = candidate.trim();

    if (!trimmed) {
      return null;
    }

    if (trimmed.includes('://')) {
      return null;
    }

    if (/\s/.test(trimmed)) {
      return null;
    }

    if (!/^[0-9a-z._-]+$/i.test(trimmed)) {
      return null;
    }

    if (trimmed.length < 4) {
      return null;
    }

    const hasDigit = /[0-9]/.test(trimmed);

    if (!hasDigit) {
      const strongContext = normalizedKey
        ? shouldUseKeyForTaskId(normalizedKey, normalizedPath)
        : pathHasTaskHint(normalizedPath);

      if (!strongContext) {
        return null;
      }

      if (trimmed.length < 8) {
        return null;
      }
    }

    return trimmed;
  };

  const directCandidate = acceptCandidate(extractCandidate(task), undefined, []);
  if (directCandidate) {
    return directCandidate;
  }

  const visited = new Set<object>();
  const queue: Array<{ value: unknown; path: string[] }> = [];

  if (task && typeof task === 'object') {
    queue.push({ value: task, path: [] });
  }

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    const { value, path } = current;

    if (!value || typeof value !== 'object') {
      continue;
    }

    if (visited.has(value as object)) {
      continue;
    }

    visited.add(value as object);

    const normalizedPath = path.map(normalizeKeySegment).filter(Boolean);

    if (Array.isArray(value)) {
      for (const item of value) {
        const candidate = acceptCandidate(extractCandidate(item), undefined, normalizedPath);
        if (candidate && pathHasTaskHint(normalizedPath)) {
          return candidate;
        }

        if (item && typeof item === 'object' && !visited.has(item as object)) {
          queue.push({ value: item, path });
        }
      }

      continue;
    }

    const record = value as Record<string, unknown>;

    for (const [rawKey, rawValue] of Object.entries(record)) {
      const normalizedKey = normalizeKeySegment(rawKey);
      const candidate = acceptCandidate(extractCandidate(rawValue), normalizedKey, normalizedPath);

      if (candidate && shouldUseKeyForTaskId(normalizedKey, normalizedPath)) {
        return candidate;
      }

      if (rawValue && typeof rawValue === 'object' && !visited.has(rawValue as object)) {
        queue.push({ value: rawValue, path: [...path, rawKey] });
      }
    }
  }

  return null;
}

function normalizeFullZipUrl(payload: MineruExtractTaskPayload | null | undefined): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const directCandidates: string[] = [];

  const enqueueString = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    directCandidates.push(trimmed);
  };

  enqueueString(payload.full_zip_url);
  enqueueString(payload.fullZipUrl);

  const queue: Array<unknown> = [];
  const visited = new Set<object>();

  const enqueueObject = (value: unknown) => {
    if (!value || typeof value !== 'object') {
      return;
    }

    if (visited.has(value as object)) {
      return;
    }

    queue.push(value);
  };

  enqueueObject(payload);
  enqueueObject(payload.result);

  const extractResult =
    (payload as { extract_result?: unknown }).extract_result
    ?? (payload as { extractResult?: unknown }).extractResult;

  if (Array.isArray(extractResult)) {
    for (const entry of extractResult) {
      enqueueObject(entry);
    }
  } else {
    enqueueObject(extractResult);
  }

  while (queue.length > 0) {
    const candidate = queue.shift();

    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const candidateObject = candidate as Record<string, unknown>;
    if (visited.has(candidateObject)) {
      continue;
    }

    visited.add(candidateObject);

    const entries = Array.isArray(candidate)
      ? (candidate as unknown[]).map((value, index) => [String(index), value] as const)
      : Object.entries(candidateObject);

    for (const [key, value] of entries) {
      const normalizedKey = normalizeKeySegment(key);

      if (typeof value === 'string') {
        const trimmed = value.trim();

        if (!trimmed) {
          continue;
        }

        if (normalizedKey.includes('zip') || normalizedKey.includes('url') || normalizedKey.includes('link')) {
          directCandidates.push(trimmed);
        } else if (/https?:\/\//i.test(trimmed) && trimmed.includes('.zip')) {
          directCandidates.push(trimmed);
        }

        continue;
      }

      if (value && typeof value === 'object') {
        enqueueObject(value);
      }
    }
  }

  for (const candidate of directCandidates) {
    if (!candidate) {
      continue;
    }

    if (/^https?:\/\//i.test(candidate)) {
      return candidate;
    }

    if (candidate.includes('.zip')) {
      return candidate;
    }
  }

  return directCandidates.length > 0 ? directCandidates[0] : null;
}

function normalizeTaskStatus(payload: MineruExtractTaskPayload | null | undefined): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const queue: Array<unknown> = [payload];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || typeof current !== 'object') {
      continue;
    }

    if (visited.has(current as object)) {
      continue;
    }

    visited.add(current as object);

    const entries = Array.isArray(current)
      ? (current as unknown[]).map((value, index) => [String(index), value] as const)
      : Object.entries(current as Record<string, unknown>);

    for (const [key, value] of entries) {
      const normalizedKey = normalizeKeySegment(key);

      if (typeof value === 'string') {
        const trimmed = value.trim();

        if (!trimmed) {
          continue;
        }

        if (
          normalizedKey === 'state'
          || normalizedKey === 'status'
          || normalizedKey.endsWith('state')
          || normalizedKey.endsWith('status')
        ) {
          return trimmed.toLowerCase();
        }
      }

      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return '';
}

function extractTaskErrorMessage(payload: MineruExtractTaskPayload | null | undefined): string {
  if (!payload || typeof payload !== 'object') {
    return 'Mineru task returned an empty payload';
  }

  const queue: Array<unknown> = [payload];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || typeof current !== 'object') {
      continue;
    }

    if (visited.has(current as object)) {
      continue;
    }

    visited.add(current as object);

    const entries = Array.isArray(current)
      ? (current as unknown[]).map((value, index) => [String(index), value] as const)
      : Object.entries(current as Record<string, unknown>);

    for (const [key, value] of entries) {
      const normalizedKey = normalizeKeySegment(key);

      if (typeof value === 'string') {
        const trimmed = value.trim();

        if (!trimmed) {
          continue;
        }

        if (
          normalizedKey.includes('error')
          || normalizedKey.includes('message')
          || normalizedKey === 'errmsg'
        ) {
          return trimmed;
        }
      }

      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  const status = normalizeTaskStatus(payload) || 'unknown';
  return `Mineru task ended with status "${status}"`;
}

function unwrapMineruData(
  response: MineruHttpResponse<MineruApiResponse<MineruExtractTaskPayload>>,
): MineruExtractTaskPayload {
  const root = response.data;

  if (!root || typeof root !== 'object') {
    throw createInvalidResponseError('Mineru response body is not an object', response);
  }

  const code = typeof root.code === 'number' ? root.code : undefined;
  if (code === undefined) {
    throw createInvalidResponseError('Mineru response missing code field', response);
  }

  if (code !== 0) {
    const message = root.msg ? String(root.msg) : 'unknown error';
    throw new MineruClientError({
      message: `Mineru API responded with code ${code}: ${message}`,
      code: 'MINERU_TASK_FAILED',
      context: {
        endpoint: response.endpoint,
        status: response.status,
        requestId: response.requestId,
        responseBody: response.rawBody,
        hint: root.trace_id ?? undefined,
      },
    });
  }

  const payload = root.data;
  if (!payload || typeof payload !== 'object') {
    throw createInvalidResponseError('Mineru response missing data payload', response);
  }

  return payload as MineruExtractTaskPayload;
}

function createInvalidResponseError(
  message: string,
  response: MineruHttpResponse<unknown>,
): MineruClientError {
  return new MineruClientError({
    message,
    code: 'MINERU_INVALID_RESPONSE',
    context: {
      endpoint: response.endpoint,
      status: response.status,
      requestId: response.requestId,
      responseBody: response.rawBody,
    },
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `mineru-op-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

function sanitizeLogPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null),
  );
}

function logInfo(event: string, payload: Record<string, unknown>): void {
  console.info(`MinerU ${event}`, sanitizeLogPayload(payload));
}

function logError(event: string, payload: Record<string, unknown>): void {
  console.error(`MinerU ${event}`, sanitizeLogPayload(payload));
}

export interface MineruClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  organizationId?: string;
  zipLoader?: () => Promise<JSZipStatic>;
  defaultTimeoutMs?: number;
  maxRetries?: number;
}

export class MineruClient {
  private readonly http: MineruHttpClient;
  private readonly loadZipModule: () => Promise<JSZipStatic>;
  private readonly organizationId?: string;

  constructor({
    apiKey,
    baseUrl,
    fetchImpl = fetch,
    organizationId,
    zipLoader,
    defaultTimeoutMs,
    maxRetries,
  }: MineruClientOptions) {
    this.http = new MineruHttpClient({
      apiKey,
      baseUrl,
      fetchImpl,
      organizationId,
      defaultTimeoutMs,
      maxRetries,
    });
    this.organizationId = organizationId?.trim() || undefined;
    this.loadZipModule = zipLoader ?? loadJSZip;
  }

  async analyzeDocument(options: MineruAnalyzeDocumentOptions): Promise<MineruAnalyzeDocumentResult> {
    const {
      signedUrl,
      documentId,
      organizationId,
      pollIntervalMs,
      timeoutMs,
      enableOcr,
      enableTable,
      enableFormula,
    } = options;
    const trimmedSignedUrl = typeof signedUrl === 'string' ? signedUrl.trim() : '';

    if (!trimmedSignedUrl) {
      throw new MineruClientError({
        message: 'MineruClient.analyzeDocument: signedUrl must be a non-empty string',
        code: 'MINERU_INVALID_ARGUMENT',
      });
    }

    const operationId = createOperationId();
    const operationStart = Date.now();
    const effectiveOrganizationId = organizationId?.trim() || this.organizationId;
    const pollTimeoutMs = timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const createTimeoutMs = Math.max(
      DEFAULT_CREATE_TASK_TIMEOUT_MS,
      Math.min(pollTimeoutMs, MAX_CREATE_TASK_TIMEOUT_MS),
    );
    const logContext = {
      operationId,
      documentId: documentId ?? undefined,
      organizationId: effectiveOrganizationId,
    } satisfies Record<string, unknown>;

    let currentTaskId: string | undefined;
    let lastRequestId: string | undefined;

    logInfo('analyzeDocument.start', logContext);

    const isOcrEnabled = enableOcr ?? true;
    const isTableEnabled = enableTable ?? true;
    const isFormulaEnabled = enableFormula ?? true;

    const bodyPayload: Record<string, unknown> = {
      document_url: trimmedSignedUrl,
      url: trimmedSignedUrl,
    };

    bodyPayload.is_ocr = isOcrEnabled;
    bodyPayload.enable_table = isTableEnabled;
    bodyPayload.enable_formula = isFormulaEnabled;

    if (documentId) {
      bodyPayload.document_id = documentId;
      bodyPayload.data_id = documentId;
    }

    if (effectiveOrganizationId) {
      bodyPayload.organization_id = effectiveOrganizationId;
    }

    try {
      const createResponse = await this.http.requestJson<MineruApiResponse<MineruExtractTaskPayload>>(
        'extract/task',
        {
          method: 'POST',
          body: JSON.stringify(bodyPayload),
          organizationId: effectiveOrganizationId,
          timeoutMs: createTimeoutMs,
        },
      );

      lastRequestId = createResponse.requestId;

      const initialPayload = unwrapMineruData(createResponse);
      const initialTaskId = normalizeTaskId(initialPayload);
      const initialStatus = normalizeTaskStatus(initialPayload);
      const initialZipUrl = normalizeFullZipUrl(initialPayload);

      if (initialTaskId) {
        currentTaskId = initialTaskId;
      }

      logInfo('analyzeDocument.taskCreated', {
        ...logContext,
        requestId: createResponse.requestId,
        taskId: currentTaskId,
        status: initialStatus || undefined,
        hasArchiveUrl: Boolean(initialZipUrl),
      });

      if (!initialTaskId) {
        if (initialZipUrl && SUCCESSFUL_TASK_STATES.has(initialStatus)) {
          const { analysis, requestId } = await this.downloadAndParseArchive(initialZipUrl);
          lastRequestId = requestId;
          const durationMs = Date.now() - operationStart;
          logInfo('analyzeDocument.success', {
            ...logContext,
            requestId,
            taskId: currentTaskId,
            durationMs,
            pages: analysis.pages.length,
            textLength: analysis.text.length,
          });
          return analysis;
        }

        throw new MineruClientError({
          message: 'Mineru response missing task identifier',
          code: 'MINERU_NO_TASK_ID',
          context: {
            endpoint: createResponse.endpoint,
            status: createResponse.status,
            requestId: createResponse.requestId,
            responseBody: createResponse.rawBody,
          },
        });
      }

      if (initialZipUrl && SUCCESSFUL_TASK_STATES.has(initialStatus)) {
        const { analysis, requestId } = await this.downloadAndParseArchive(initialZipUrl);
        lastRequestId = requestId;
        const durationMs = Date.now() - operationStart;
        logInfo('analyzeDocument.success', {
          ...logContext,
          requestId,
          taskId: currentTaskId,
          durationMs,
          pages: analysis.pages.length,
        });
        return analysis;
      }

      let pollResult: {
        payload: MineruExtractTaskPayload;
        response: MineruHttpResponse<MineruApiResponse<MineruExtractTaskPayload>>;
      };

      try {
        pollResult = await this.pollExtractTask(initialTaskId, {
          pollIntervalMs,
          timeoutMs: pollTimeoutMs,
          organizationId: effectiveOrganizationId,
        });
        lastRequestId = pollResult.response.requestId;
      } catch (error) {
        if (error instanceof MineruClientError && error.context?.requestId) {
          lastRequestId = error.context.requestId;
        }
        throw error;
      }

      const pollStatus = normalizeTaskStatus(pollResult.payload);
      const fullZipUrl = normalizeFullZipUrl(pollResult.payload);

      logInfo('analyzeDocument.taskPolled', {
        ...logContext,
        requestId: pollResult.response.requestId,
        taskId: currentTaskId,
        status: pollStatus || undefined,
        hasArchiveUrl: Boolean(fullZipUrl),
      });

      if (!fullZipUrl) {
        throw new MineruClientError({
          message: 'Mineru task did not provide a result archive URL',
          code: 'MINERU_NO_RESULT_URL',
          context: {
            endpoint: pollResult.response.endpoint,
            status: pollResult.response.status,
            requestId: pollResult.response.requestId,
            responseBody: pollResult.response.rawBody,
          },
        });
      }

      const { analysis, requestId: archiveRequestId } = await this.downloadAndParseArchive(fullZipUrl);
      lastRequestId = archiveRequestId;

      const durationMs = Date.now() - operationStart;
      logInfo('analyzeDocument.success', {
        ...logContext,
        requestId: archiveRequestId,
        taskId: currentTaskId,
        durationMs,
        pages: analysis.pages.length,
        textLength: analysis.text.length,
      });

      return analysis;
    } catch (error) {
      const durationMs = Date.now() - operationStart;
      const message = error instanceof Error ? error.message : String(error);

      logError('analyzeDocument.error', {
        ...logContext,
        taskId: currentTaskId,
        requestId: lastRequestId,
        durationMs,
        message,
      });

      throw error;
    }
  }

  private async pollExtractTask(
    taskId: string,
    options: { pollIntervalMs?: number; timeoutMs?: number; organizationId?: string } = {},
  ): Promise<{
    payload: MineruExtractTaskPayload;
    response: MineruHttpResponse<MineruApiResponse<MineruExtractTaskPayload>>;
  }> {
    const interval = Math.max(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS);
    const timeout = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const start = Date.now();
    const organizationOverride = options.organizationId?.trim() || undefined;

    while (true) {
      const response = await this.http.requestJson<MineruApiResponse<MineruExtractTaskPayload>>(
        `extract/task/${taskId}`,
        { organizationId: organizationOverride },
      );

      const payload = unwrapMineruData(response);
      const status = normalizeTaskStatus(payload);

      if (SUCCESSFUL_TASK_STATES.has(status)) {
        return { payload, response };
      }

      if (FAILURE_TASK_STATES.has(status)) {
        const errorMessage = extractTaskErrorMessage(payload);
        throw new MineruClientError({
          message: `Mineru extraction task failed: ${errorMessage}`,
          code: 'MINERU_TASK_FAILED',
          context: {
            endpoint: response.endpoint,
            status: response.status,
            requestId: response.requestId,
            responseBody: response.rawBody,
            hint: payload.error?.code ?? payload.err_msg ?? undefined,
          },
        });
      }

      if (Date.now() - start > timeout) {
        throw new MineruHttpError({
          message: `Mineru extraction task polling timed out after ${timeout}ms`,
          status: 504,
          endpoint: response.endpoint,
          requestId: response.requestId,
          code: 'MINERU_TIMEOUT',
        });
      }

      await delay(interval);
    }
  }

  private async downloadAndParseArchive(fullZipUrl: string): Promise<{
    analysis: MineruAnalyzeDocumentResult;
    requestId: string;
  }> {
    const archiveResponse = await this.http.requestArrayBuffer(fullZipUrl, {
      includeAuthHeader: false,
    });

    try {
      const JSZip = await this.loadZipModule();
      const archive = await JSZip.loadAsync(archiveResponse.data);
      const files = archive?.files ?? {};
      const entries = Object.values(files).filter((file): file is ZipEntry => !file.dir);
      const jsonEntries = entries
        .filter((file) => isJsonLikeEntry(file.name))
        .sort((a, b) => scoreArchiveEntry(b.name) - scoreArchiveEntry(a.name));

      if (jsonEntries.length === 0) {
        throw new MineruClientError({
          message: 'Mineru archive missing JSON payload',
          code: 'MINERU_ARCHIVE_ERROR',
          context: {
            endpoint: archiveResponse.endpoint,
            requestId: archiveResponse.requestId,
          },
        });
      }

      let fallbackAnalysis: MineruAnalyzeDocumentResult | null = null;
      let lastParseError: Error | undefined;

      for (const entry of jsonEntries) {
        try {
          const rawText = await entry.async('string');
          const parsed = parseJsonLikeContent(entry.name, rawText);
          const analysis = normalizeMineruAnalysis(parsed);
          const enriched = await enrichAnalysisWithFallbackText(analysis, entries);

          if (hasUsableAnalysis(enriched)) {
            return { analysis: enriched, requestId: archiveResponse.requestId };
          }

          if (!fallbackAnalysis) {
            fallbackAnalysis = enriched;
          }
        } catch (parseError) {
          lastParseError = parseError instanceof Error ? parseError : new Error(String(parseError));
        }
      }

      if (fallbackAnalysis) {
        const enriched = await enrichAnalysisWithFallbackText(fallbackAnalysis, entries);
        if (hasUsableAnalysis(enriched)) {
          return { analysis: enriched, requestId: archiveResponse.requestId };
        }
      }

      const errorContext = {
        endpoint: archiveResponse.endpoint,
        requestId: archiveResponse.requestId,
        files: jsonEntries.map((entry) => entry.name),
      } satisfies Record<string, unknown>;

      throw new MineruClientError({
        message: 'Mineru archive did not contain usable analysis data',
        code: 'MINERU_EMPTY_ANALYSIS',
        context: errorContext,
        cause: lastParseError,
      });
    } catch (error) {
      if (error instanceof MineruClientError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new MineruClientError({
        message: `Failed to process Mineru archive: ${message}`,
        code: 'MINERU_ARCHIVE_ERROR',
        context: {
          endpoint: archiveResponse.endpoint,
          requestId: archiveResponse.requestId,
        },
        cause: error,
      });
    }
  }

  getBaseUrl(): string {
    return this.http.getBaseUrl();
  }
}

const KNOWN_SECTION_ENTRIES = Object.entries(SECTION_KEYWORD_MAP) as Array<
  [Exclude<SectionType, 'unknown'>, string[]]
>;

const SNIPPET_MAX_LENGTH = 280;

function scoreArchiveEntry(name: string): number {
  const normalized = name.toLowerCase();
  let score = 0;

  if (!normalized.includes('/')) {
    score += 5;
  }

  if (normalized.includes('analysis')) {
    score += 25;
  }

  if (normalized.includes('result')) {
    score += 20;
  }

  if (normalized.includes('document')) {
    score += 15;
  }

  if (normalized.includes('layout') || normalized.includes('page')) {
    score += 10;
  }

  if (normalized.includes('meta') || normalized.includes('log')) {
    score -= 10;
  }

  if (normalized.endsWith('jsonl')) {
    score += 12;
  }

  return score;
}

function isJsonLikeEntry(name: string): boolean {
  return /\.jsonl?$/i.test(name);
}

function parseJsonLikeContent(entryName: string, rawText: string): unknown {
  const normalizedName = entryName.toLowerCase();

  if (normalizedName.endsWith('.jsonl')) {
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const parsedLines = lines.map((line) => JSON.parse(line));

    const container: Record<string, unknown> = { items: parsedLines };

    if (parsedLines.every((value) => value && typeof value === 'object')) {
      container.pages = parsedLines;
    }

    return container;
  }

  return JSON.parse(rawText);
}

async function enrichAnalysisWithFallbackText(
  analysis: MineruAnalyzeDocumentResult,
  entries: ZipEntry[],
): Promise<MineruAnalyzeDocumentResult> {
  if (hasUsableAnalysis(analysis)) {
    return analysis;
  }

  const fallbackText = await extractFallbackText(entries);
  if (fallbackText) {
    return { ...analysis, text: fallbackText };
  }

  return analysis;
}

async function extractFallbackText(entries: ZipEntry[]): Promise<string | null> {
  const textEntries = entries
    .filter((entry) => /\.(txt|md|markdown)$/i.test(entry.name))
    .sort((a, b) => scoreTextEntry(b.name) - scoreTextEntry(a.name));

  for (const entry of textEntries) {
    try {
      const text = (await entry.async('string')).trim();
      if (text.length > 0) {
        return text;
      }
    } catch {
      // Ignore errors when reading fallback text entries.
    }
  }

  return null;
}

function scoreTextEntry(name: string): number {
  const normalized = name.toLowerCase();
  let score = 0;

  if (normalized.includes('text')) {
    score += 15;
  }

  if (normalized.includes('full')) {
    score += 10;
  }

  if (normalized.includes('markdown') || normalized.endsWith('.md') || normalized.endsWith('.markdown')) {
    score += 8;
  }

  if (normalized.includes('ocr')) {
    score += 5;
  }

  if (normalized.includes('raw')) {
    score -= 2;
  }

  if (normalized.includes('clean')) {
    score += 4;
  }

  return score;
}

function hasUsableAnalysis(analysis: MineruAnalyzeDocumentResult): boolean {
  if (analysis.pages.length > 0) {
    return true;
  }

  if (typeof analysis.text === 'string' && analysis.text.trim().length > 0) {
    return true;
  }

  return Boolean(analysis.structureSummary);
}

function collectAnalysisRoots(payload: any): any[] {
  const candidates = new Set<object>();
  const queue: Array<unknown> = [];

  const enqueue = (value: unknown) => {
    if (!value || typeof value !== 'object') {
      return;
    }

    const objectValue = value as object;
    if (candidates.has(objectValue)) {
      return;
    }

    candidates.add(objectValue);
    queue.push(objectValue);
  };

  enqueue(payload);

  const rootAny = payload as any;
  enqueue(rootAny?.data);
  enqueue(rootAny?.result);
  enqueue(rootAny?.document);
  enqueue(rootAny?.analysis);

  const extractResultSources = [
    rootAny?.extract_result,
    rootAny?.extractResult,
    rootAny?.data?.extract_result,
    rootAny?.data?.extractResult,
  ];

  for (const source of extractResultSources) {
    if (!source) {
      continue;
    }

    if (Array.isArray(source)) {
      for (const entry of source) {
        enqueue(entry);

        if (entry && typeof entry === 'object') {
          const entryAny = entry as any;
          enqueue(entryAny?.result);
          enqueue(entryAny?.document);
        }
      }
    } else {
      enqueue(source);

      if (source && typeof source === 'object') {
        const sourceAny = source as any;
        enqueue(sourceAny?.result);
        enqueue(sourceAny?.document);
      }
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || typeof current !== 'object') {
      continue;
    }

    const entries = Array.isArray(current)
      ? current as unknown[]
      : Object.values(current as Record<string, unknown>);

    for (const value of entries) {
      if (value && typeof value === 'object') {
        const objectValue = value as object;
        if (!candidates.has(objectValue)) {
          candidates.add(objectValue);
          queue.push(objectValue);
        }
      }
    }
  }

  const result = Array.from(candidates);
  result.sort((a, b) => scoreAnalysisRoot(b) - scoreAnalysisRoot(a));
  return result;
}

function scoreAnalysisRoot(root: any): number {
  if (!root || typeof root !== 'object') {
    return 0;
  }

  let score = 0;

  const objectRoot = root as any;

  if (Array.isArray(objectRoot?.pages)) {
    score += 40;
  }

  if (Array.isArray(objectRoot?.document?.pages)) {
    score += 30;
  }

  if (Array.isArray(objectRoot?.result?.pages)) {
    score += 20;
  }

  if (typeof objectRoot?.text === 'string' && objectRoot.text.trim()) {
    score += 20;
  }

  if (
    typeof objectRoot?.full_text === 'string'
    || typeof objectRoot?.fullText === 'string'
    || typeof objectRoot?.text_content === 'string'
  ) {
    score += 15;
  }

  if (
    objectRoot?.structureSummary
    || objectRoot?.structure_summary
    || objectRoot?.structural_summary
    || objectRoot?.structure
  ) {
    score += 10;
  }

  if (!Array.isArray(root) && typeof root === 'object') {
    for (const key of Object.keys(objectRoot as Record<string, unknown>)) {
      const normalized = normalizeKeySegment(key);

      if (normalized.includes('page')) {
        score += 5;
      }

      if (normalized.includes('result')) {
        score += 3;
      }

      if (normalized.includes('document')) {
        score += 2;
      }
    }
  }

  return score;
}

type PageSourceCandidate = {
  pages: any[];
  priority: number;
};

function looksLikePageItem(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.text === 'string' && record.text.trim()) {
    return true;
  }

  if (Array.isArray(record.blocks) && record.blocks.length > 0) {
    return true;
  }

  if (
    typeof record.pageNumber === 'number'
    || typeof record.page_number === 'number'
    || typeof record.page_index === 'number'
  ) {
    return true;
  }

  return false;
}

function scorePageCandidate(pages: any[], priorityBoost: number): number {
  let score = priorityBoost;

  if (pages.length > 0) {
    score += 1;
  }

  if (pages.some(looksLikePageItem)) {
    score += 10;
  }

  return score;
}

function extractPagesFromRoot(root: any): MineruPage[] {
  const candidates: PageSourceCandidate[] = [];

  const addCandidate = (value: unknown, priorityBoost = 0) => {
    if (!Array.isArray(value) || value.length === 0) {
      return;
    }

    candidates.push({
      pages: value,
      priority: scorePageCandidate(value, priorityBoost),
    });
  };

  const objectRoot = root as any;

  addCandidate(objectRoot?.pages, 30);
  addCandidate(objectRoot?.document?.pages, 25);
  addCandidate(objectRoot?.document?.page_list, 20);
  addCandidate(objectRoot?.document?.pageList, 20);
  addCandidate(objectRoot?.result?.pages, 20);
  addCandidate(objectRoot?.result?.document?.pages, 18);

  const extractResult = objectRoot?.extract_result ?? objectRoot?.extractResult;

  if (Array.isArray(extractResult)) {
    for (const entry of extractResult) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const entryAny = entry as any;
      addCandidate(entryAny?.pages, 15);
      addCandidate(entryAny?.document?.pages, 15);
      addCandidate(entryAny?.result?.pages, 12);
      addCandidate(entryAny?.result?.document?.pages, 12);
    }
  } else if (extractResult && typeof extractResult === 'object') {
    const entryAny = extractResult as any;
    addCandidate(entryAny?.pages, 15);
    addCandidate(entryAny?.document?.pages, 15);
    addCandidate(entryAny?.result?.pages, 12);
    addCandidate(entryAny?.result?.document?.pages, 12);
  }

  if (objectRoot && typeof objectRoot === 'object') {
    for (const [key, value] of Object.entries(objectRoot as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        const normalizedKey = normalizeKeySegment(key);
        if (normalizedKey.includes('page') || normalizedKey.includes('sheet')) {
          addCandidate(value, 16);
        }
      } else if (value && typeof value === 'object') {
        const nested = value as any;
        addCandidate(nested?.pages, 10);
        addCandidate(nested?.page_list, 10);
      }
    }
  }

  if (Array.isArray(root)) {
    for (const entry of root) {
      const nestedPages = extractPagesFromRoot(entry);
      if (nestedPages.length > 0) {
        return nestedPages;
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);

  for (const candidate of candidates) {
    const normalized = candidate.pages.map((page, index) => normalizeMineruPage(page, index));
    if (normalized.length > 0) {
      return normalized;
    }
  }

  if (candidates.length > 0) {
    return candidates[0]!.pages.map((page, index) => normalizeMineruPage(page, index));
  }

  return [];
}

function extractTextFromRoot(root: any, pages: MineruPage[]): string {
  const candidates: string[] = [];

  const addCandidate = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }

    const trimmed = value.trim();
    if (trimmed) {
      candidates.push(trimmed);
    }
  };

  const objectRoot = root as any;

  addCandidate(objectRoot?.text);
  addCandidate(objectRoot?.full_text);
  addCandidate(objectRoot?.fullText);
  addCandidate(objectRoot?.text_content);
  addCandidate(objectRoot?.document?.text);
  addCandidate(objectRoot?.document?.full_text);
  addCandidate(objectRoot?.document?.fullText);
  addCandidate(objectRoot?.result?.text);
  addCandidate(objectRoot?.result?.full_text);
  addCandidate(objectRoot?.result?.fullText);

  const extractResult = objectRoot?.extract_result ?? objectRoot?.extractResult;
  if (Array.isArray(extractResult)) {
    for (const entry of extractResult) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const entryAny = entry as any;
      addCandidate(entryAny?.text);
      addCandidate(entryAny?.full_text);
      addCandidate(entryAny?.fullText);
      addCandidate(entryAny?.result?.text);
      addCandidate(entryAny?.result?.full_text);
      addCandidate(entryAny?.result?.fullText);
    }
  } else if (extractResult && typeof extractResult === 'object') {
    const entryAny = extractResult as any;
    addCandidate(entryAny?.text);
    addCandidate(entryAny?.full_text);
    addCandidate(entryAny?.fullText);
    addCandidate(entryAny?.result?.text);
    addCandidate(entryAny?.result?.full_text);
    addCandidate(entryAny?.result?.fullText);
  }

  if (candidates.length > 0) {
    return candidates[0]!;
  }

  if (pages.length > 0) {
    const joined = pages.map((page) => page.text).filter(Boolean).join('\n\n');
    return joined.trim();
  }

  return '';
}

function pickStructureSummaryCandidate(root: any): any {
  if (!root || typeof root !== 'object') {
    return null;
  }

  const objectRoot = root as any;

  const directCandidates = [
    objectRoot.structureSummary,
    objectRoot.structure_summary,
    objectRoot.structural_summary,
    objectRoot.structure,
  ];

  for (const candidate of directCandidates) {
    if (candidate && typeof candidate === 'object') {
      return candidate;
    }
  }

  const queue: Array<unknown> = [
    objectRoot.document,
    objectRoot.result,
    objectRoot.analysis,
  ];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || typeof current !== 'object') {
      continue;
    }

    const currentObject = current as any;

    const candidate =
      currentObject.structureSummary
      ?? currentObject.structure_summary
      ?? currentObject.structural_summary
      ?? currentObject.structure
      ?? null;

    if (candidate && typeof candidate === 'object') {
      return candidate;
    }

    for (const value of Object.values(currentObject as Record<string, unknown>)) {
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return null;
}

function normalizeMineruAnalysis(payload: any): MineruAnalyzeDocumentResult {
  const candidates = collectAnalysisRoots(payload);
  let fallback: MineruAnalyzeDocumentResult | null = null;

  for (const candidate of candidates) {
    const pages = extractPagesFromRoot(candidate);
    const text = extractTextFromRoot(candidate, pages);
    const structureSummaryRaw = pickStructureSummaryCandidate(candidate);

    const analysis: MineruAnalyzeDocumentResult = {
      pages,
      text,
      structureSummary: normalizeStructuralSummary(structureSummaryRaw),
    };

    if (hasUsableAnalysis(analysis)) {
      return analysis;
    }

    if (!fallback) {
      fallback = analysis;
    }
  }

  return fallback ?? { pages: [], text: '', structureSummary: null };
}

function normalizeMineruPage(raw: any, index: number): MineruPage {
  const pageNumber = typeof raw?.pageNumber === 'number'
    ? raw.pageNumber
    : typeof raw?.page_number === 'number'
      ? raw.page_number
      : index + 1;

  const width = typeof raw?.width === 'number'
    ? raw.width
    : typeof raw?.pageWidth === 'number'
      ? raw.pageWidth
      : typeof raw?.page_width === 'number'
        ? raw.page_width
        : undefined;

  const height = typeof raw?.height === 'number'
    ? raw.height
    : typeof raw?.pageHeight === 'number'
      ? raw.pageHeight
      : typeof raw?.page_height === 'number'
        ? raw.page_height
        : undefined;

  const blocks = Array.isArray(raw?.blocks)
    ? raw.blocks.map(normalizeMineruBlock)
    : undefined;

  const text = extractPageText(raw, blocks);

  return {
    pageNumber,
    text,
    width,
    height,
    blocks,
  };
}

function extractPageText(raw: any, blocks?: MineruBlock[]): string {
  const directText = typeof raw?.text === 'string' ? raw.text : undefined;
  if (directText && directText.trim().length > 0) {
    return directText;
  }

  if (typeof raw?.content === 'string' && raw.content.trim().length > 0) {
    return raw.content;
  }

  if (Array.isArray(raw?.content)) {
    const parts = raw.content
      .map((part: unknown) => {
        if (typeof part === 'string') {
          return part;
        }

        if (part && typeof part === 'object') {
          const candidate =
            typeof (part as { text?: unknown }).text === 'string'
              ? (part as { text: string }).text
              : typeof (part as { content?: unknown }).content === 'string'
                ? (part as { content: string }).content
                : undefined;

          if (candidate && candidate.trim().length > 0) {
            return candidate;
          }
        }

        return undefined;
      })
      .filter((value: string | undefined): value is string => Boolean(value && value.trim().length > 0));

    if (parts.length > 0) {
      return parts.join('\n');
    }
  }

  if (Array.isArray(raw?.lines)) {
    const lines = raw.lines
      .map((line: unknown) => (typeof line === 'string' ? line : undefined))
      .filter((value: string | undefined): value is string => Boolean(value && value.trim().length > 0));

    if (lines.length > 0) {
      return lines.join('\n');
    }
  }

  if (blocks && blocks.length > 0) {
    const blockText = blocks
      .map((block) => block.text?.trim())
      .filter((value): value is string => Boolean(value && value.length > 0));

    if (blockText.length > 0) {
      return blockText.join('\n');
    }
  }

  return '';
}

function normalizeMineruBlock(raw: any): MineruBlock {
  const block: MineruBlock = {
    id: typeof raw?.id === 'string' ? raw.id : undefined,
    type: typeof raw?.type === 'string'
      ? raw.type
      : typeof raw?.block_type === 'string'
        ? raw.block_type
        : 'text',
    text: typeof raw?.text === 'string'
      ? raw.text
      : typeof raw?.content === 'string'
        ? raw.content
        : undefined,
    confidence: typeof raw?.confidence === 'number' ? raw.confidence : undefined,
    headingLevel: typeof raw?.headingLevel === 'number'
      ? raw.headingLevel
      : typeof raw?.heading_level === 'number'
        ? raw.heading_level
        : undefined,
    metadata: typeof raw?.metadata === 'object' && raw?.metadata !== null
      ? raw.metadata as Record<string, unknown>
      : undefined,
    children: Array.isArray(raw?.children)
      ? raw.children.map(normalizeMineruBlock)
      : undefined,
  };

  const boundingSource = raw?.boundingBox ?? raw?.bounding_box ?? raw?.bbox;
  if (
    boundingSource &&
    typeof boundingSource === 'object' &&
    typeof boundingSource.x === 'number' &&
    typeof boundingSource.y === 'number' &&
    typeof boundingSource.width === 'number' &&
    typeof boundingSource.height === 'number'
  ) {
    block.boundingBox = {
      x: boundingSource.x,
      y: boundingSource.y,
      width: boundingSource.width,
      height: boundingSource.height,
    };
  }

  return block;
}

function normalizeStructuralSummary(raw: any): MineruStructuralSummary | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const pagesSource: any[] = Array.isArray(raw.pages)
    ? raw.pages
    : Array.isArray(raw.pageSummaries)
      ? raw.pageSummaries
      : [];

  const pages: MineruStructuralSummaryPage[] = pagesSource
    .map((page: any, index: number) => {
      const pageNumber = typeof page?.pageNumber === 'number'
        ? page.pageNumber
        : typeof page?.page_number === 'number'
          ? page.page_number
          : index + 1;

      const blockCount = typeof page?.blockCount === 'number'
        ? page.blockCount
        : typeof page?.blocks === 'number'
          ? page.blocks
          : typeof page?.block_count === 'number'
            ? page.block_count
            : 0;

      const headingsRaw = page?.headings ?? page?.heading ?? page?.top_headings;
      const headings = Array.isArray(headingsRaw)
        ? headingsRaw.filter((item: unknown) => typeof item === 'string').slice(0, 10)
        : typeof headingsRaw === 'string'
          ? [headingsRaw]
          : undefined;

      const keywords = Array.isArray(page?.keywords)
        ? page.keywords.filter((item: unknown) => typeof item === 'string')
        : undefined;

      return {
        pageNumber,
        blockCount,
        headings,
        keywords,
      } satisfies MineruStructuralSummaryPage;
    })
    .filter((page): page is MineruStructuralSummaryPage => !!page);

  return {
    confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
    pages,
  };
}

function extractBlockText(block: MineruBlock): string {
  const parts: string[] = [];

  if (typeof block.text === 'string' && block.text.trim().length > 0) {
    parts.push(block.text.trim());
  }

  if (Array.isArray(block.children)) {
    for (const child of block.children) {
      const childText = extractBlockText(child);
      if (childText) {
        parts.push(childText);
      }
    }
  }

  return parts.join('\n').trim();
}

function buildSnippet(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= SNIPPET_MAX_LENGTH) {
    return compact;
  }
  return `${compact.slice(0, SNIPPET_MAX_LENGTH - 1)}…`;
}

function classifyTextSegment(text: string): {
  type: SectionType;
  keywords: string[];
  confidence: number;
} {
  const lower = text.toLowerCase();

  let bestType: SectionType = 'unknown';
  let bestKeywords: string[] = [];
  let bestScore = 0;

  for (const [sectionType, keywords] of KNOWN_SECTION_ENTRIES) {
    const matches = keywords.filter(keyword => lower.includes(keyword));
    if (matches.length === 0) {
      continue;
    }

    const score = matches.length / keywords.length;
    if (score > bestScore) {
      bestScore = score;
      bestType = sectionType;
      bestKeywords = matches;
    }
  }

  const lengthRatio = Math.min(text.length / 600, 1);
  const confidence = bestScore > 0
    ? Math.min(0.95, 0.45 + bestScore * 0.45 + 0.1 * lengthRatio)
    : Math.max(0.1, 0.2 * lengthRatio);

  return {
    type: bestType,
    keywords: bestKeywords,
    confidence,
  };
}

export function convertMineruPagesToSections(
  pages: MineruPage[],
  fallbackText?: string,
): MineruSegmentationResult {
  const sections: ParsedSection[] = [];
  const sources: SectionSource[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    const pageTexts: string[] = [];

    if (Array.isArray(page.blocks) && page.blocks.length > 0) {
      for (const block of page.blocks) {
        const blockText = extractBlockText(block);
        if (blockText) {
          pageTexts.push(blockText);
        }
      }
    }

    if (pageTexts.length === 0 && page.text.trim().length > 0) {
      pageTexts.push(page.text);
    }

    for (const candidate of pageTexts) {
      const normalized = candidate.replace(/\s+/g, ' ').trim();
      if (normalized.length === 0) {
        continue;
      }

      const classification = classifyTextSegment(normalized);
      const snippet = buildSnippet(normalized);
      const sectionKey = `${page.pageNumber}:${classification.type}:${snippet}`;

      if (seen.has(sectionKey)) {
        continue;
      }

      seen.add(sectionKey);

      const pageRange = { start: page.pageNumber, end: page.pageNumber } as const;

      sections.push({
        type: classification.type,
        content: normalized,
        keywords: classification.keywords,
        confidence: classification.confidence,
        pageRange,
        snippet,
      });

      sources.push({
        sectionType: classification.type,
        pageRange,
        snippet,
        confidence: classification.confidence,
      });
    }
  }

  if (sections.length === 0 && typeof fallbackText === 'string') {
    const trimmedFallback = fallbackText.trim();

    if (trimmedFallback.length > 0) {
      const paragraphCandidates = trimmedFallback
        .split(/\n{2,}/)
        .map((entry) => entry.replace(/\s+/g, ' ').trim())
        .filter((entry) => entry.length > 0)
        .slice(0, 10);

      if (paragraphCandidates.length === 0) {
        paragraphCandidates.push(trimmedFallback.replace(/\s+/g, ' '));
      }

      paragraphCandidates.forEach((paragraph, index) => {
        const classification = classifyTextSegment(paragraph);
        const snippet = buildSnippet(paragraph);
        const pageRange = { start: index + 1, end: index + 1 } as const;

        sections.push({
          type: classification.type,
          content: paragraph,
          keywords: classification.keywords,
          confidence: classification.confidence,
          pageRange,
          snippet,
        });

        sources.push({
          sectionType: classification.type,
          pageRange,
          snippet,
          confidence: classification.confidence,
        });
      });
    }
  }

  return { sections, sources };
}

export {
  DEFAULT_MINERU_BASE_URL,
  pickBaseUrl as resolveMineruBaseUrl,
  sanitizeBaseUrl,
} from './mineru-http-client.ts';
export { MineruClientError, MineruHttpError } from './mineru-errors.ts';
