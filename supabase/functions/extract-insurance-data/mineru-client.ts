import {
  ParsedSection,
  SectionSource,
  SECTION_KEYWORD_MAP,
  SectionType,
} from './classifier.ts';

const DEFAULT_MINERU_BASE_URL = "https://api.mineru.com" as const;

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
  bytes: Uint8Array;
  mimeType: string;
  documentId?: string;
  fileName?: string;
  organizationId?: string;
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

function sanitizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function pickBaseUrl(baseUrl?: string): string {
  const envOverride = Deno.env.get("MINERU_API_URL")?.trim();
  const candidate = baseUrl?.trim() || envOverride || DEFAULT_MINERU_BASE_URL;
  return sanitizeBaseUrl(candidate);
}

export interface MineruClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  organizationId?: string;
}

export class MineruClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImpl;
  private readonly organizationId?: string;

  constructor({ apiKey, baseUrl, fetchImpl = fetch, organizationId }: MineruClientOptions) {
    this.apiKey = apiKey;
    this.baseUrl = pickBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
    this.organizationId = organizationId?.trim();
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
    if (!path.startsWith("/")) {
      path = `/${path}`;
    }

    return `${this.baseUrl}${path}`;
  }

  private buildHeaders(additional?: HeadersLike): Headers {
    const headers = this.createAuthHeaders();
    headers.set('Content-Type', 'application/json');

    if (additional) {
      const additionalHeaders = new Headers(additional);
      additionalHeaders.forEach((value, key) => {
        headers.set(key, value);
      });
    }

    return headers;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { headers, body, method = "GET" } = init;

    const response = await this.fetchImpl(this.buildUrl(path), {
      ...init,
      method,
      body,
      headers: this.buildHeaders(headers),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Mineru request failed (${response.status}): ${errorBody}`);
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

  async analyzeDocument(options: MineruAnalyzeDocumentOptions): Promise<MineruAnalyzeDocumentResult> {
    const { bytes, mimeType, documentId, fileName, organizationId } = options;

    if (!(bytes instanceof Uint8Array)) {
      throw new Error('MineruClient.analyzeDocument: bytes must be a Uint8Array');
    }

    const effectiveOrganizationId = organizationId?.trim() || this.organizationId;
    const payload = new FormData();

    const normalizedFileName = fileName?.trim() ||
      (documentId ? `${documentId}.${mimeType.split('/').pop() || 'bin'}` : 'document');

    payload.append('file', new Blob([bytes], { type: mimeType }), normalizedFileName);
    payload.append('mime_type', mimeType);

    if (documentId) {
      payload.append('document_id', documentId);
    }

    if (effectiveOrganizationId) {
      payload.append('organization_id', effectiveOrganizationId);
    }

    const response = await this.fetchImpl(this.buildUrl('/v1/document/analyze'), {
      method: 'POST',
      body: payload,
      headers: this.createAuthHeaders(effectiveOrganizationId),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Mineru analysis failed (${response.status}): ${errorBody}`);
    }

    const analysisPayload = await response.json();
    return normalizeMineruAnalysis(analysisPayload);
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
