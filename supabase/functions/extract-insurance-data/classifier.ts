// Section classification utilities shared across MinerU integration and unified builder

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

export const SECTION_KEYWORD_MAP: Record<Exclude<SectionType, 'unknown'>, string[]> = {
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

export function calculateExtractionConfidence(sections: ParsedSection[]): 'high' | 'medium' | 'low' {
  const totalSections = sections.length;
  if (totalSections === 0) return 'low';

  const identifiedSections = sections.filter(s => s.type !== 'unknown').length;
  const ratio = identifiedSections / totalSections;

  if (ratio > 0.7) return 'high';
  if (ratio > 0.4) return 'medium';
  return 'low';
}
