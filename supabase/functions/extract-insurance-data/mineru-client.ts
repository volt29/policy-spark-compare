import {
  ParsedSection,
  SectionSource,
  SectionType,
  SECTION_KEYWORD_MAP
} from './classifier.ts';

interface MineruClientOptions {
  apiKey: string;
  baseUrl?: string;
  organizationId?: string;
  timeoutMs?: number;
}

interface MineruAnalyzeParams {
  bytes: Uint8Array;
  mimeType: string;
  documentId: string;
  fileName?: string;
}

export interface MineruBlock {
  id?: string;
  type?: string;
  category?: string;
  label?: string;
  text: string;
  confidence?: number;
  pageNumber: number;
  bbox?: number[];
  children?: MineruBlock[];
}

export interface MineruPage {
  pageNumber: number;
  text: string;
  width?: number;
  height?: number;
  blocks: MineruBlock[];
}

export interface MineruStructuralSummary {
  confidence: number | null;
  blockCounts: Record<string, number>;
  tables: number;
  keyValuePairs: number;
  pages: Array<{
    pageNumber: number;
    blockCount: number;
    headings: string[];
  }>;
}

interface MineruAnalysisResult {
  text: string;
  pages: MineruPage[];
  structureSummary: MineruStructuralSummary | null;
}

export class MineruClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly organizationId?: string;
  private readonly timeoutMs: number;

  constructor(options: MineruClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.mineru.com';
    this.organizationId = options.organizationId;
    this.timeoutMs = options.timeoutMs ?? 120000;
  }

  async analyzeDocument(params: MineruAnalyzeParams): Promise<MineruAnalysisResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const payload = {
        document: {
          content: encodeBase64(params.bytes),
          mime_type: params.mimeType,
          document_id: params.documentId,
          file_name: params.fileName ?? `${params.documentId}.pdf`
        },
        features: {
          text: true,
          structure: true
        }
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-Client-Name': 'policy-spark-extract-insurance-data'
      };

      if (this.organizationId) {
        headers['X-Mineru-Organization'] = this.organizationId;
      }

      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/documents:analyze`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await safeReadText(response);
        throw new Error(`MinerU API error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      return normalizeMineruResponse(data);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('MinerU request timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function convertMineruPagesToSections(pages: MineruPage[]): { sections: ParsedSection[]; sources: SectionSource[] } {
  const sections: ParsedSection[] = [];

  for (const page of pages) {
    const textCandidates: MineruBlock[] = flattenBlocks(page.blocks);

    if (page.text && page.text.trim().length > 0) {
      const syntheticBlock: MineruBlock = {
        id: `page-${page.pageNumber}`,
        text: page.text,
        pageNumber: page.pageNumber,
        confidence: averageConfidence(textCandidates) ?? 0.4,
        type: 'page'
      };
      textCandidates.unshift(syntheticBlock);
    }

    for (const block of textCandidates) {
      if (!block.text || block.text.trim().length < 20) {
        continue;
      }

      const classification = classifyBlock(block);
      const snippet = block.text.length > 240
        ? `${block.text.slice(0, 237)}...`
        : block.text;

      sections.push({
        type: classification.type,
        content: block.text,
        keywords: classification.keywords,
        confidence: classification.confidence,
        pageRange: { start: block.pageNumber, end: block.pageNumber },
        snippet
      });
    }
  }

  const sources: SectionSource[] = sections.map(section => ({
    sectionType: section.type,
    pageRange: section.pageRange,
    snippet: section.snippet,
    confidence: section.confidence
  }));

  return { sections, sources };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function safeReadText(response: Response): Promise<string> {
  return response.text().catch(() => '');
}

function normalizeMineruResponse(data: any): MineruAnalysisResult {
  const documentNode = data?.document ?? data?.data ?? data ?? {};
  const pagesNode = Array.isArray(documentNode.pages)
    ? documentNode.pages
    : Array.isArray(documentNode.page_items)
      ? documentNode.page_items
      : [];

  const pages: MineruPage[] = pagesNode.map((page: any, index: number) => {
    const pageNumber = resolveNumber(page.page_number, index + 1);
    const blocksNode = Array.isArray(page.blocks)
      ? page.blocks
      : Array.isArray(page.elements)
        ? page.elements
        : [];

    const blocks = blocksNode.map((block: any) => normalizeBlock(block, pageNumber));
    const text = resolveText(page.text, page.content, blocks) ?? '';

    return {
      pageNumber,
      text,
      width: resolveNumber(page.width, page.size?.width),
      height: resolveNumber(page.height, page.size?.height),
      blocks
    };
  });

  const text = typeof documentNode.text === 'string' && documentNode.text.trim().length > 0
    ? documentNode.text
    : pages.map(page => page.text).join('\n\n');

  return {
    text,
    pages,
    structureSummary: summarizeStructure(pages)
  };
}

function normalizeBlock(rawBlock: any, pageNumber: number): MineruBlock {
  const childrenNode = Array.isArray(rawBlock.children)
    ? rawBlock.children
    : Array.isArray(rawBlock.items)
      ? rawBlock.items
      : [];

  const block: MineruBlock = {
    id: resolveString(rawBlock.id, rawBlock.block_id),
    type: resolveString(rawBlock.type, rawBlock.block_type),
    category: resolveString(rawBlock.category, rawBlock.semantic_type),
    label: resolveString(rawBlock.label, rawBlock.title),
    text: resolveText(rawBlock.text, rawBlock.content, undefined, rawBlock.value) ?? '',
    confidence: resolveNumber(rawBlock.confidence, rawBlock.score),
    pageNumber,
    bbox: Array.isArray(rawBlock.bbox)
      ? rawBlock.bbox
          .map((value: unknown) => Number(value))
          .filter(value => Number.isFinite(value))
      : undefined,
    children: childrenNode.map((child: any) => normalizeBlock(child, pageNumber))
  };

  return block;
}

function resolveText(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
    if (Array.isArray(candidate)) {
      const joined = candidate
        .map(value => (typeof value === 'string' ? value : ''))
        .filter(value => value.trim().length > 0)
        .join('\n');
      if (joined.trim().length > 0) {
        return joined;
      }
    }
  }
  return null;
}

function resolveString(...candidates: Array<unknown>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function resolveNumber(...candidates: Array<unknown>): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string') {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function flattenBlocks(blocks: MineruBlock[]): MineruBlock[] {
  const result: MineruBlock[] = [];
  const stack = [...blocks];

  while (stack.length > 0) {
    const current = stack.shift()!;
    result.push(current);
    if (current.children && current.children.length > 0) {
      stack.push(...current.children);
    }
  }

  return result;
}

function classifyBlock(block: MineruBlock): { type: SectionType; keywords: string[]; confidence: number } {
  const haystack = `${block.text} ${block.category ?? ''} ${block.label ?? ''}`.toLowerCase();
  let bestType: SectionType = 'unknown';
  let bestScore = 0;
  let matchedKeywords: string[] = [];

  for (const [sectionType, keywords] of Object.entries(SECTION_KEYWORD_MAP)) {
    const matches = keywords.filter(keyword => haystack.includes(keyword));
    if (matches.length === 0) continue;

    const score = matches.length / keywords.length;
    if (score > bestScore) {
      bestType = sectionType as SectionType;
      bestScore = score;
      matchedKeywords = matches;
    }
  }

  const normalizedConfidence = block.confidence ?? (bestScore > 0 ? Math.min(0.9, 0.4 + bestScore) : 0.2);

  return {
    type: bestType,
    keywords: matchedKeywords,
    confidence: normalizedConfidence
  };
}

function summarizeStructure(pages: MineruPage[]): MineruStructuralSummary | null {
  if (pages.length === 0) {
    return null;
  }

  const blockCounts: Record<string, number> = {};
  let confidenceSum = 0;
  let confidenceCount = 0;
  let tableCount = 0;
  let keyValueCount = 0;

  const pageSummaries = pages.map(page => {
    let blockCount = 0;
    const headings: string[] = [];

    for (const block of flattenBlocks(page.blocks)) {
      blockCount += 1;

      const categoryKey = (block.category ?? block.type ?? 'unknown').toLowerCase();
      blockCounts[categoryKey] = (blockCounts[categoryKey] ?? 0) + 1;

      if (typeof block.confidence === 'number') {
        confidenceSum += block.confidence;
        confidenceCount += 1;
      }

      const lowerType = (block.type ?? '').toLowerCase();
      const lowerCategory = (block.category ?? '').toLowerCase();

      if (lowerType.includes('table') || lowerCategory.includes('table')) {
        tableCount += 1;
      }
      if (lowerType.includes('key') || lowerCategory.includes('key')) {
        keyValueCount += 1;
      }

      if (lowerType.includes('heading') || lowerCategory.includes('heading')) {
        headings.push(block.text.slice(0, 80));
      }
    }

    return {
      pageNumber: page.pageNumber,
      blockCount,
      headings: headings.slice(0, 5)
    };
  });

  const confidence = confidenceCount > 0 ? confidenceSum / confidenceCount : null;

  return {
    confidence,
    blockCounts,
    tables: tableCount,
    keyValuePairs: keyValueCount,
    pages: pageSummaries
  };
}

function averageConfidence(blocks: MineruBlock[]): number | null {
  const confidences = blocks
    .map(block => block.confidence)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (confidences.length === 0) {
    return null;
  }

  const sum = confidences.reduce((acc, value) => acc + value, 0);
  return sum / confidences.length;
}
