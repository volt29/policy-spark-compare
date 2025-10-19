// Section Classifier - identifies insurance document sections using keywords

import type { ParsedPage } from './pdf-parser.ts';

export type SectionType =
  | 'insured'
  | 'base_contract'
  | 'additional_contract'
  | 'assistance'
  | 'premium'
  | 'discount'
  | 'duration'
  | 'unknown';

export interface ParsedSection {
  type: SectionType;
  content: string;
  keywords: string[];
  confidence: number;
  pageRange: { start: number; end: number } | null;
  snippet: string;
}

export interface SectionSource {
  sectionType: SectionType;
  pageRange: { start: number; end: number } | null;
  snippet: string;
  confidence: number;
}

export interface ProductTypeHeuristicResult {
  predictedType: string | null;
  confidence: number;
  matchedKeywords: string[];
  matchesByType: Record<string, string[]>;
  source: 'segmentation' | 'builder';
}

export interface SegmentationResult {
  sections: ParsedSection[];
  sources: SectionSource[];
  productTypeHeuristic: ProductTypeHeuristicResult | null;
}

const KEYWORD_MAP: Record<Exclude<SectionType, 'unknown'>, string[]> = {
  insured: ['ubezpieczony', 'wiek', 'imię', 'nazwisko', 'data urodzenia', 'pesel'],
  base_contract: ['umowa podstawowa', 'życie', 'on', 'cu', 'główna', 'podstawowa ochrona'],
  additional_contract: ['umowa dodatkowa', 'rozszerzenie', 'ab14', 'yo14', 'nw', 'ns', 'szpital', 'nowotwór'],
  assistance: ['assistance', 'pomoc', 'asysta', 'wsparcie', 'medicover', 'interwencja'],
  premium: ['składka', 'opłata', 'koszt', 'cena', 'zł', 'pln', 'miesięczna', 'roczna'],
  discount: ['zniżka', 'rabat', 'upust', 'promocja', 'więcej za mniej', 'zlecenie'],
  duration: ['okres', 'czas trwania', 'od', 'do', 'data rozpoczęcia', 'data zakończenia', 'miesięcy', 'lat']
};

const PRODUCT_TYPE_KEYWORDS: Record<string, string[]> = {
  life_insurance: ['na życie', 'ubezpieczenie na życie', 'życiowe', 'terminowe', 'kapitał'],
  health_insurance: ['zdrowot', 'leczenie', 'medycz', 'hospitalizacja', 'opieka zdrowotna'],
  accident_insurance: ['wypadk', 'nw', 'następstw nieszczęśliwych', 'uszczerbek', 'kontuzja'],
  travel_insurance: ['podróż', 'turystycz', 'travel', 'koszty leczenia za granicą', 'assistance podróżne'],
  property_insurance: ['mieszkanie', 'dom', 'majątk', 'nieruchomość', 'pożar'],
  auto_insurance: ['oc', 'ac', 'samochód', 'pojazd', 'komunikacyjn']
};

export function inferProductTypeFromText(
  text: string,
  source: ProductTypeHeuristicResult['source']
): ProductTypeHeuristicResult | null {
  if (!text || text.trim().length === 0) {
    return null;
  }

  const lowerText = text.toLowerCase();
  let bestMatch: { type: string; keywords: string[]; score: number } | null = null;
  const matchesByType: Record<string, string[]> = {};

  for (const [productType, keywords] of Object.entries(PRODUCT_TYPE_KEYWORDS)) {
    const matched = keywords.filter(keyword => lowerText.includes(keyword));
    if (matched.length > 0) {
      matchesByType[productType] = matched;
      const score = matched.length / keywords.length;
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { type: productType, keywords: matched, score };
      }
    }
  }

  return {
    predictedType: bestMatch?.type ?? null,
    confidence: bestMatch?.score ?? 0,
    matchedKeywords: bestMatch?.keywords ?? [],
    matchesByType,
    source
  };
}

type SegmentInput =
  | string[]
  | {
      pages: ParsedPage[];
      linePageMap?: number[];
      lines?: string[];
      fullText?: string;
    };

/**
 * Segment text into insurance sections using keyword detection
 */
export function segmentInsuranceSections(input: SegmentInput): SegmentationResult {
  const pages: ParsedPage[] = Array.isArray(input)
    ? input.map((text, index) => ({ pageNumber: index + 1, text }))
    : input.pages;
  const providedLineMap = Array.isArray(input) ? undefined : input.linePageMap;
  const providedLines = Array.isArray(input) ? undefined : input.lines;
  const providedFullText = Array.isArray(input) ? undefined : input.fullText;

  const fullText =
    providedFullText ??
    pages
      .map(page => page.text)
      .join('\n\n');

  const lines = providedLines ?? fullText.replace(/\r\n/g, '\n').split('\n');
  const linePageMap = providedLineMap ?? buildFallbackLinePageMap(pages, lines.length);

  console.log('🔍 Classifier: Starting section segmentation...');

  const paragraphDescriptors = collectParagraphs(lines);
  const sections: ParsedSection[] = [];

  for (const paragraph of paragraphDescriptors) {
    if (paragraph.text.trim().length < 10) continue;

    const lowerText = paragraph.text.toLowerCase();
    let bestMatch: { type: SectionType; keywords: string[]; score: number } | null = null;

    for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
      const matchedKeywords = keywords.filter(keyword => lowerText.includes(keyword));
      const score = matchedKeywords.length / keywords.length;

      if (matchedKeywords.length > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = {
          type: category as SectionType,
          keywords: matchedKeywords,
          score
        };
      }
    }

    const pageRange = resolvePageRange(linePageMap, paragraph.startLine, paragraph.endLine);
    const snippet = paragraph.text.length > 240
      ? `${paragraph.text.slice(0, 237)}...`
      : paragraph.text;

    if (bestMatch && bestMatch.score > 0) {
      sections.push({
        type: bestMatch.type,
        content: paragraph.text,
        keywords: bestMatch.keywords,
        confidence: bestMatch.score,
        pageRange,
        snippet
      });
    } else {
      sections.push({
        type: 'unknown',
        content: paragraph.text,
        keywords: [],
        confidence: 0,
        pageRange,
        snippet
      });
    }
  }

  console.log(`✅ Classifier: Identified ${sections.length} sections`);
  console.log(
    '📊 Section breakdown:',
    sections.reduce((acc, section) => {
      acc[section.type] = (acc[section.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  );

  const sources: SectionSource[] = sections.map(section => ({
    sectionType: section.type,
    pageRange: section.pageRange,
    snippet: section.snippet,
    confidence: section.confidence
  }));

  const productTypeHeuristic = inferProductTypeFromText(fullText, 'segmentation');

  return { sections, sources, productTypeHeuristic };
}

interface ParagraphDescriptor {
  text: string;
  startLine: number;
  endLine: number;
}

function collectParagraphs(lines: string[]): ParagraphDescriptor[] {
  const descriptors: ParagraphDescriptor[] = [];
  let buffer: string[] = [];
  let startLine = -1;

  const flushBuffer = (currentLineIndex: number) => {
    if (buffer.length === 0) return;
    descriptors.push({
      text: buffer.join('\n'),
      startLine,
      endLine: currentLineIndex - 1
    });
    buffer = [];
    startLine = -1;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim().length === 0) {
      flushBuffer(index);
      continue;
    }

    if (buffer.length === 0) {
      startLine = index;
    }
    buffer.push(line);
  }

  flushBuffer(lines.length);
  return descriptors;
}

function buildFallbackLinePageMap(pages: ParsedPage[], targetLength: number): number[] {
  const map: number[] = [];
  for (const page of pages) {
    const pageLines = page.text ? page.text.split('\n') : [''];
    const lineCount = pageLines.length;
    for (let i = 0; i < lineCount; i++) {
      map.push(page.pageNumber);
    }
    // Preserve blank separation between pages for downstream paragraph split
    map.push(page.pageNumber);
  }

  while (map.length < targetLength) {
    map.push(pages.length > 0 ? pages[pages.length - 1].pageNumber : 1);
  }

  return map.slice(0, targetLength);
}

function resolvePageRange(
  linePageMap: number[] | undefined,
  startLine: number,
  endLine: number
): { start: number; end: number } | null {
  if (!linePageMap || linePageMap.length === 0) {
    return null;
  }

  const slice = linePageMap.slice(startLine, endLine + 1).filter(page => page > 0);
  if (slice.length === 0) {
    return null;
  }

  const start = Math.min(...slice);
  const end = Math.max(...slice);
  return { start, end };
}

/**
 * Extract specific section types from parsed sections
 */
export function extractSectionsByType(
  sections: ParsedSection[],
  type: ParsedSection['type']
): ParsedSection[] {
  return sections.filter(s => s.type === type);
}

/**
 * Get confidence score for extraction quality
 */
export function calculateExtractionConfidence(sections: ParsedSection[]): 'high' | 'medium' | 'low' {
  const totalSections = sections.length;
  if (totalSections === 0) return 'low';
  
  const identifiedSections = sections.filter(s => s.type !== 'unknown').length;
  const ratio = identifiedSections / totalSections;
  
  if (ratio > 0.7) return 'high';
  if (ratio > 0.4) return 'medium';
  return 'low';
}
