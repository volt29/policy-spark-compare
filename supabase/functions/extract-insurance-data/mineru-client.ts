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

const TASK_IDENTIFIER_KEYS = [
  'task_id',
  'taskId',
  'id',
  'task_identifier',
  'taskIdentifier',
  'task_uuid',
  'taskUuid',
  'uuid',
  'task',
] as const;

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

  const directCandidate = extractCandidate(task);
  if (directCandidate) {
    return directCandidate;
  }

  const visited = new Set<object>();
  const queue: unknown[] = [];

  if (task && typeof task === 'object') {
    queue.push(task);
  }

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || typeof current !== 'object') {
      continue;
    }

    if (visited.has(current as object)) {
      continue;
    }

    visited.add(current as object);

    if (Array.isArray(current)) {
      for (const item of current) {
        const candidate = extractCandidate(item);
        if (candidate) {
          return candidate;
        }

        if (item && typeof item === 'object' && !visited.has(item as object)) {
          queue.push(item);
        }
      }
      continue;
    }

    const record = current as Record<string, unknown>;

    for (const key of TASK_IDENTIFIER_KEYS) {
      const candidate = extractCandidate(record[key]);
      if (candidate) {
        return candidate;
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object' && !visited.has(value as object)) {
        queue.push(value);
      }
    }
  }

  return null;
}

function normalizeFullZipUrl(payload: MineruExtractTaskPayload | null | undefined): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidates: Array<unknown> = [
    payload.full_zip_url,
    payload.fullZipUrl,
  ];

  const result = payload.result;
  if (result && typeof result === 'object') {
    candidates.push((result as { full_zip_url?: unknown }).full_zip_url);
    candidates.push((result as { fullZipUrl?: unknown }).fullZipUrl);

    for (const value of Object.values(result)) {
      if (typeof value === 'string') {
        candidates.push(value);
      }
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function normalizeTaskStatus(payload: MineruExtractTaskPayload | null | undefined): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const candidates = [payload.state, payload.status];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().toLowerCase();
    }
  }

  return '';
}

function extractTaskErrorMessage(payload: MineruExtractTaskPayload | null | undefined): string {
  if (!payload || typeof payload !== 'object') {
    return 'Mineru task returned an empty payload';
  }

  const errorMessages = [
    payload.error?.message,
    payload.error?.err_msg,
    payload.err_msg,
  ];

  for (const message of errorMessages) {
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
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
    const { signedUrl, documentId, organizationId, pollIntervalMs, timeoutMs } = options;
    const trimmedSignedUrl = typeof signedUrl === 'string' ? signedUrl.trim() : '';

    if (!trimmedSignedUrl) {
      throw new MineruClientError({
        message: 'MineruClient.analyzeDocument: signedUrl must be a non-empty string',
        code: 'MINERU_INVALID_ARGUMENT',
      });
    }

    const effectiveOrganizationId = organizationId?.trim() || this.organizationId;
    const bodyPayload: Record<string, unknown> = {
      document_url: trimmedSignedUrl,
      url: trimmedSignedUrl,
    };

    if (documentId) {
      bodyPayload.document_id = documentId;
      bodyPayload.data_id = documentId;
    }

    if (effectiveOrganizationId) {
      bodyPayload.organization_id = effectiveOrganizationId;
    }

    const createResponse = await this.http.requestJson<MineruApiResponse<MineruExtractTaskPayload>>(
      'extract/task',
      {
        method: 'POST',
        body: JSON.stringify(bodyPayload),
        organizationId: effectiveOrganizationId,
      },
    );

    const initialPayload = unwrapMineruData(createResponse);
    const initialTaskId = normalizeTaskId(initialPayload);
    const initialStatus = normalizeTaskStatus(initialPayload);
    const initialZipUrl = normalizeFullZipUrl(initialPayload);

    if (!initialTaskId) {
      if (initialZipUrl && SUCCESSFUL_TASK_STATES.has(initialStatus)) {
        return await this.downloadAndParseArchive(initialZipUrl);
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
      return await this.downloadAndParseArchive(initialZipUrl);
    }

    const pollResult = await this.pollExtractTask(initialTaskId, {
      pollIntervalMs,
      timeoutMs,
      organizationId: effectiveOrganizationId,
    });

    const fullZipUrl = normalizeFullZipUrl(pollResult.payload);
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

    return await this.downloadAndParseArchive(fullZipUrl);
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

  private async downloadAndParseArchive(fullZipUrl: string): Promise<MineruAnalyzeDocumentResult> {
    const archiveResponse = await this.http.requestArrayBuffer(fullZipUrl, {
      includeAuthHeader: false,
    });

    try {
      const JSZip = await this.loadZipModule();
      const archive = await JSZip.loadAsync(archiveResponse.data);
      const files = archive?.files ?? {};
      const jsonEntry = Object.values(files)
        .find((file) => !file.dir && file.name.toLowerCase().endsWith('.json'));

      if (!jsonEntry) {
        throw new MineruClientError({
          message: 'Mineru archive missing JSON payload',
          code: 'MINERU_ARCHIVE_ERROR',
          context: {
            endpoint: archiveResponse.endpoint,
            requestId: archiveResponse.requestId,
          },
        });
      }

      const jsonText = await jsonEntry.async('string');
      const parsed = JSON.parse(jsonText);

      return normalizeMineruAnalysis(parsed);
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

function normalizeMineruAnalysis(payload: any): MineruAnalyzeDocumentResult {
  const root = payload?.data ?? payload ?? {};

  const rawPages: any[] = Array.isArray(root.pages)
    ? root.pages
    : Array.isArray(root.document?.pages)
      ? root.document.pages
      : [];

  const pages = rawPages.map((page, index) => normalizeMineruPage(page, index));

  const text = typeof root.text === 'string'
    ? root.text
    : typeof root.full_text === 'string'
      ? root.full_text
      : pages.map(page => page.text).join('\n\n');

  const structureSummaryRaw = root.structureSummary
    ?? root.structure_summary
    ?? root.structural_summary
    ?? root.structure
    ?? null;

  return {
    pages,
    text,
    structureSummary: normalizeStructuralSummary(structureSummaryRaw),
  };
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

  const text = typeof raw?.text === 'string'
    ? raw.text
    : typeof raw?.content === 'string'
      ? raw.content
      : Array.isArray(raw?.content)
        ? raw.content.filter((part: unknown) => typeof part === 'string').join('\n')
        : '';

  return {
    pageNumber,
    text,
    width,
    height,
    blocks,
  };
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

export function convertMineruPagesToSections(pages: MineruPage[]): MineruSegmentationResult {
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

  return { sections, sources };
}

export {
  DEFAULT_MINERU_BASE_URL,
  pickBaseUrl as resolveMineruBaseUrl,
  sanitizeBaseUrl,
} from './mineru-http-client.ts';
export { MineruClientError, MineruHttpError } from './mineru-errors.ts';
