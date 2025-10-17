// Section Classifier - identifies insurance document sections using keywords

export interface ParsedSection {
  type: 'insured' | 'base_contract' | 'additional_contract' | 'assistance' | 'premium' | 'discount' | 'duration' | 'unknown';
  content: string;
  keywords: string[];
  confidence: number;
}

// Keyword map for classification
const KEYWORD_MAP: Record<string, string[]> = {
  insured: ['ubezpieczony', 'wiek', 'imię', 'nazwisko', 'data urodzenia', 'pesel'],
  base_contract: ['umowa podstawowa', 'życie', 'on', 'cu', 'główna', 'podstawowa ochrona'],
  additional_contract: ['umowa dodatkowa', 'rozszerzenie', 'ab14', 'yo14', 'nw', 'ns', 'szpital', 'nowotwór'],
  assistance: ['assistance', 'pomoc', 'asysta', 'wsparcie', 'medicover', 'interwencja'],
  premium: ['składka', 'opłata', 'koszt', 'cena', 'zł', 'pln', 'miesięczna', 'roczna'],
  discount: ['zniżka', 'rabat', 'upust', 'promocja', 'więcej za mniej', 'zlecenie'],
  duration: ['okres', 'czas trwania', 'od', 'do', 'data rozpoczęcia', 'data zakończenia', 'miesięcy', 'lat']
};

/**
 * Segment text into insurance sections using keyword detection
 */
export function segmentInsuranceSections(textPages: string[]): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const fullText = textPages.join('\n\n');
  
  console.log('🔍 Classifier: Starting section segmentation...');
  
  // Split by paragraphs and headers
  const paragraphs = fullText.split(/\n\n+/);
  
  for (const paragraph of paragraphs) {
    if (paragraph.trim().length < 10) continue; // Skip empty or very short paragraphs
    
    const lowerText = paragraph.toLowerCase();
    let bestMatch: { type: string; keywords: string[]; score: number } | null = null;
    
    // Find best matching category
    for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
      const matchedKeywords = keywords.filter(keyword => lowerText.includes(keyword));
      const score = matchedKeywords.length / keywords.length;
      
      if (matchedKeywords.length > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { type: category, keywords: matchedKeywords, score };
      }
    }
    
    if (bestMatch && bestMatch.score > 0) {
      sections.push({
        type: bestMatch.type as ParsedSection['type'],
        content: paragraph,
        keywords: bestMatch.keywords,
        confidence: bestMatch.score
      });
    } else {
      sections.push({
        type: 'unknown',
        content: paragraph,
        keywords: [],
        confidence: 0
      });
    }
  }
  
  console.log(`✅ Classifier: Identified ${sections.length} sections`);
  console.log('📊 Section breakdown:', 
    sections.reduce((acc, s) => {
      acc[s.type] = (acc[s.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  );
  
  return sections;
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
