import {
  ParsedSection,
  SectionSource,
  SECTION_KEYWORD_MAP,
  SectionType,
} from './classifier.ts';

const DEFAULT_MINERU_BASE_URL = "https://mineru.net/api/v4" as const;

type FetchImpl = typeof fetch;

type HeadersLike = HeadersInit | undefined;

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
  | 'failed'
  | 'error'
  | 'cancelled'
  | 'canceled';

interface MineruExtractTaskError {
  code?: string;
  message?: string;
}

interface MineruExtractTaskPayload {
  task_id: string;
  status: MineruExtractTaskStatus | string;
  result?: {
    full_zip_url?: string;
    fullZipUrl?: string;
    [key: string]: unknown;
  };
  error?: MineruExtractTaskError | null;
  [key: string]: unknown;
}

interface MineruExtractTaskResponse extends MineruExtractTaskPayload {}

const SUCCESSFUL_TASK_STATES = new Set<string>(['succeeded', 'completed', 'success']);
const FAILURE_TASK_STATES = new Set<string>(['failed', 'error', 'cancelled', 'canceled']);

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
] as const;

function normalizeTaskId(task: MineruExtractTaskResponse | null | undefined): string | null {
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

function normalizeFullZipUrl(result: MineruExtractTaskPayload['result'] | null | undefined): string | null {
  if (!result) {
    return null;
  }

  const candidates = [
    (result as { full_zip_url?: unknown }).full_zip_url,
    (result as { fullZipUrl?: unknown }).fullZipUrl,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
}

function sanitizeBaseUrl(url: string): string {
  let sanitized = url.trim();

  sanitized = sanitized.replace(/\/+$/, "");

  const lower = sanitized.toLowerCase();
  const legacySuffixes = [
    "/document/analyze",
    "/documents/analyze",
  ];

  for (const suffix of legacySuffixes) {
    if (lower.endsWith(suffix)) {
      return sanitized.slice(0, sanitized.length - suffix.length);
    }
  }

  return sanitized;
}

function pickBaseUrl(baseUrl?: string): string {
  const envOverride = typeof Deno !== 'undefined'
    ? Deno.env.get("MINERU_API_URL")?.trim()
    : undefined;
  const candidate = baseUrl?.trim() || envOverride || DEFAULT_MINERU_BASE_URL;

  return sanitizeBaseUrl(candidate);
}

export interface MineruClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  organizationId?: string;
  zipLoader?: () => Promise<JSZipStatic>;
}

export class MineruHttpError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly hint?: string;

  constructor({ message, status, endpoint, hint }: {
    message: string;
    status: number;
    endpoint: string;
    hint?: string;
  }) {
    super(message);
    this.name = 'MineruHttpError';
    this.status = status;
    this.endpoint = endpoint;
    this.hint = hint;
  }
}

export class MineruClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImpl;
  private readonly organizationId?: string;
  private readonly loadZipModule: () => Promise<JSZipStatic>;

  constructor({ apiKey, baseUrl, fetchImpl = fetch, organizationId, zipLoader }: MineruClientOptions) {
    this.apiKey = apiKey;
    this.baseUrl = pickBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
    this.organizationId = organizationId?.trim();
    this.loadZipModule = zipLoader ?? loadJSZip;
  }

  private createAuthHeaders(organizationIdOverride?: string): Headers {
    const headers = new Headers({
      Authorization: `Bearer ${this.apiKey}`,
    });

    const effectiveOrganizationId = organizationIdOverride?.trim() || this.organizationId;
    if (effectiveOrganizationId) {
      headers.set('X-Organization-Id', effectiveOrganizationId);
    }

    return headers;
  }

  private buildUrl(path: string): string {
    const normalizedPath = path.replace(/^\/+/, '');

    if (!normalizedPath) {
      return this.baseUrl;
    }

    try {
      const base = new URL(this.baseUrl);
      const baseSegments = base.pathname.split('/').filter(Boolean);
      const pathSegments = normalizedPath.split('/').filter(Boolean);

      let overlap = 0;
      const maxOverlap = Math.min(baseSegments.length, pathSegments.length);

      for (let i = 1; i <= maxOverlap; i++) {
        let match = true;

        for (let j = 0; j < i; j++) {
          const baseSegment = baseSegments[baseSegments.length - i + j];
          const pathSegment = pathSegments[j];

          if (!baseSegment || baseSegment.toLowerCase() !== pathSegment.toLowerCase()) {
            match = false;
            break;
          }
        }

        if (match) {
          overlap = i;
        }
      }

      const combinedSegments = [...baseSegments, ...pathSegments.slice(overlap)];
      base.pathname = `/${combinedSegments.join('/')}`;

      return base.toString();
    } catch {
      const trimmedBase = this.baseUrl.replace(/\/+$/, '');
      return `${trimmedBase}/${normalizedPath}`;
    }
  }

  private buildHeaders(
    additional?: HeadersLike,
    hasBody: boolean = false,
    organizationIdOverride?: string,
  ): Headers {
    const headers = this.createAuthHeaders(organizationIdOverride);

    if (hasBody) {
      const additionalHeaders = additional ? new Headers(additional) : null;
      if (!additionalHeaders || !additionalHeaders.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }

    if (additional) {
      const additionalHeaders = new Headers(additional);
      additionalHeaders.forEach((value, key) => {
        headers.set(key, value);
      });
    }

    return headers;
  }

  async request<T>(
    path: string,
    init: RequestInit = {},
    organizationIdOverride?: string,
  ): Promise<T> {
    const { headers, body, method = "GET", ...rest } = init;
    const endpoint = this.buildUrl(path);

    const response = await this.fetchImpl(endpoint, {
      ...rest,
      method,
      body,
      headers: this.buildHeaders(headers, typeof body !== 'undefined', organizationIdOverride),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const hint = response.status === 404
        ? 'document not found / sprawdź endpoint'
        : undefined;

      throw new MineruHttpError({
        message: `Mineru request failed (${response.status}): ${errorBody}`,
        status: response.status,
        endpoint,
        hint,
      });
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const responseText = await response.text();
    if (!responseText) {
      return undefined as T;
    }

    return JSON.parse(responseText) as T;
  }

  private async pollExtractTask(
    taskId: string,
    options: { pollIntervalMs?: number; timeoutMs?: number; organizationIdOverride?: string } = {},
  ): Promise<MineruExtractTaskResponse> {
    const endpointPath = `extract/task/${taskId}`;
    const endpoint = this.buildUrl(endpointPath);
    const interval = Math.max(options.pollIntervalMs ?? 2500, 250);
    const timeout = options.timeoutMs ?? 5 * 60 * 1000;
    const start = Date.now();

    while (true) {
      const response = await this.request<MineruExtractTaskResponse>(
        endpointPath,
        {},
        options.organizationIdOverride,
      );
      const statusRaw = typeof response?.status === 'string' ? response.status.toLowerCase() : '';

      if (SUCCESSFUL_TASK_STATES.has(statusRaw)) {
        return response;
      }

      if (FAILURE_TASK_STATES.has(statusRaw)) {
        const errorMessage = response?.error?.message || `Mineru task ended with status "${response?.status}"`;
        const hint = response?.error?.code;

        throw new MineruHttpError({
          message: `Mineru extraction task failed: ${errorMessage}`,
          status: 502,
          endpoint,
          hint,
        });
      }

      if (Date.now() - start > timeout) {
        throw new MineruHttpError({
          message: `Mineru extraction task polling timed out after ${timeout}ms`,
          status: 504,
          endpoint,
        });
      }

      await this.delay(interval);
    }
  }

  private async downloadAndParseArchive(fullZipUrl: string): Promise<MineruAnalyzeDocumentResult> {
    const response = await this.fetchImpl(fullZipUrl);

    if (!response.ok) {
      const body = await response.text().catch(() => '');

      throw new MineruHttpError({
        message: `Mineru archive download failed (${response.status}): ${body}`,
        status: response.status,
        endpoint: fullZipUrl,
      });
    }

    const zipBuffer = await response.arrayBuffer();

    try {
      const JSZip = await this.loadZipModule();
      const archive = await JSZip.loadAsync(zipBuffer);
      const files = archive?.files ?? {};
      const jsonEntry = Object.values(files)
        .find((file) => !file.dir && file.name.toLowerCase().endsWith('.json'));

      if (!jsonEntry) {
        throw new Error('Mineru archive missing JSON payload');
      }

      const jsonText = await jsonEntry.async('string');
      const parsed = JSON.parse(jsonText);

      return normalizeMineruAnalysis(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to process Mineru archive: ${message}`);
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async analyzeDocument(options: MineruAnalyzeDocumentOptions): Promise<MineruAnalyzeDocumentResult> {
    const { signedUrl, documentId, organizationId, pollIntervalMs, timeoutMs } = options;

    if (!signedUrl || typeof signedUrl !== 'string') {
      throw new Error('MineruClient.analyzeDocument: signedUrl must be a non-empty string');
    }

    const effectiveOrganizationId = organizationId?.trim() || this.organizationId;

    const bodyPayload: Record<string, unknown> = {
      document_url: signedUrl,
      document_id: documentId,
    };

    if (effectiveOrganizationId) {
      bodyPayload.organization_id = effectiveOrganizationId;
    }

    const task = await this.request<MineruExtractTaskResponse>(
      'extract/task',
      {
        method: 'POST',
        body: JSON.stringify(bodyPayload),
      },
      effectiveOrganizationId,
    );

    const initialTaskId = normalizeTaskId(task);
    const initialStatus = typeof task?.status === 'string' ? task.status.toLowerCase() : '';
    const initialZipUrl = normalizeFullZipUrl(task?.result);

    if (!initialTaskId) {
      if (initialZipUrl && SUCCESSFUL_TASK_STATES.has(initialStatus)) {
        return await this.downloadAndParseArchive(initialZipUrl);
      }

      throw new Error('MineruClient.analyzeDocument: missing task identifier in response');
    }

    const pollResult = await this.pollExtractTask(initialTaskId, {
      pollIntervalMs,
      timeoutMs,
      organizationIdOverride: effectiveOrganizationId,
    });

    const fullZipUrl = normalizeFullZipUrl(pollResult?.result);

    if (!fullZipUrl) {
      throw new Error('MineruClient.analyzeDocument: Mineru task did not provide a result archive URL');
    }

    return await this.downloadAndParseArchive(fullZipUrl);
  }

  getBaseUrl(): string {
    return this.baseUrl;
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

export { DEFAULT_MINERU_BASE_URL, pickBaseUrl as resolveMineruBaseUrl, sanitizeBaseUrl };
