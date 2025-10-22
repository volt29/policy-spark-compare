// Unified JSON Builder - constructs standardized offer structure

import {
  ParsedSection,
  ProductTypeHeuristicResult,
  inferProductTypeFromText
} from './classifier.ts';

function parseNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const sanitized = value
      .replace(/[^0-9,.-]/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(/,(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');

    const match = sanitized.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number.parseFloat(match[0]);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

const PAYMENT_KEYWORDS: Array<{ pattern: RegExp; cycle: PaymentCycle }> = [
  { pattern: /(miesi[aą]c|co\s+miesi[aą]c|monthly|12\s*rat)/i, cycle: 'monthly' },
  { pattern: /(roczn|co\s+rok|annual|yearly|12\s*miesi[aą]cy)/i, cycle: 'annual' },
  { pattern: /(kwarta|quarter)/i, cycle: 'quarterly' },
  { pattern: /(półroc|semi-?annual|co\s+pół\s+roku)/i, cycle: 'semiannual' },
  { pattern: /(jednoraz|z\s+góry|single\s+payment)/i, cycle: 'single' }
];

const extractStrings = (value: unknown): string[] => {
  if (!value) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractStrings(entry));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keysToInspect = [
      'frequency',
      'frequencies',
      'cycle',
      'cycles',
      'option',
      'options',
      'billing_period',
      'payment_frequency',
      'paymentCycle',
      'paymentSchedule',
      'plan',
      'type',
      'label'
    ];
    return keysToInspect.flatMap((key) => extractStrings(record[key]));
  }
  return [];
};

const detectPaymentCycle = (value: string): PaymentCycle | null => {
  for (const entry of PAYMENT_KEYWORDS) {
    if (entry.pattern.test(value)) {
      return entry.cycle;
    }
  }
  return null;
};

function extractPaymentSchedule(
  sections: ParsedSection[],
  aiData: any
): { normalized_cycles: PaymentCycle[]; raw_mentions: string[] } {
  const normalized = new Set<PaymentCycle>();
  const rawMentions = new Set<string>();

  const considerValue = (value: string) => {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      return;
    }
    rawMentions.add(cleaned);
    const detected = detectPaymentCycle(cleaned.toLowerCase());
    if (detected) {
      normalized.add(detected);
    }
  };

  const aiCandidates: unknown[] = [
    aiData?.payment_frequency,
    aiData?.payment?.frequency,
    aiData?.payment?.frequencies,
    aiData?.payment?.cycles,
    aiData?.payment?.options,
    aiData?.payment?.plans,
    aiData?.premium?.payment_frequency,
    aiData?.premium?.payment_schedule,
    aiData?.premium?.billing_period,
    aiData?.premium?.plan,
    aiData?.billing_cycle,
    aiData?.billingFrequency,
    aiData?.paymentCycle,
    aiData?.payment_schedule,
    aiData?.paymentPlan,
  ];

  for (const candidate of aiCandidates) {
    for (const text of extractStrings(candidate)) {
      considerValue(text);
    }
  }

  const relevantSections = sections.filter((section) =>
    section.type === 'premium' ||
    section.type === 'base_contract' ||
    section.type === 'additional_contract' ||
    section.type === 'unknown'
  );

  for (const section of relevantSections) {
    const lines = section.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) =>
        line.length > 0 &&
        /(płatno|rat|składk|opłat|rata)/i.test(line)
      );

    lines.forEach(considerValue);
  }

  return {
    normalized_cycles: Array.from(normalized),
    raw_mentions: Array.from(rawMentions).slice(0, 10),
  };
}

export interface UnifiedOffer {
  offer_id: string;
  source_document: string;
  insured: Array<{
    name: string;
    age: number | 'missing';
    role: string;
    plans: Array<{
      type: string;
      sum: number | 'missing';
      premium: number | 'missing';
      variant: string;
      duration: string;
    }>;
  }>;
  base_contracts: Array<{
    name: string;
    sum: number | 'missing';
    premium: number | 'missing';
    variant: string;
  }>;
  additional_contracts: Array<{
    name: string;
    coverage: string;
    premium: number | 'missing';
  }>;
  discounts: string[];
  total_premium_before_discounts: number | 'missing';
  total_premium_after_discounts: number | 'missing';
  payment_schedule: {
    normalized_cycles: PaymentCycle[];
    raw_mentions: string[];
  };
  assistance: Array<{
    name: string;
    coverage: string;
    limits: string;
    response_time: string;
    contact: string;
    exclusions: string[];
  }>;
  exclusions: Array<{
    name: string;
    description: string;
    keywords: string[];
  }>;
  duration: {
    start: string;
    end: string;
    variant: string;
  };
  notes: string[];
  missing_fields: string[];
  extraction_confidence: 'high' | 'medium' | 'low';
}

export type PaymentCycle = 'monthly' | 'annual' | 'quarterly' | 'semiannual' | 'single';

export interface UnifiedOfferSourceEntry {
  category: string;
  sectionType: ParsedSection['type'];
  pageRange: { start: number; end: number } | null;
  snippet: string;
  confidence: number;
}

export interface UnifiedOfferBuildResult {
  offer: UnifiedOffer;
  sources: UnifiedOfferSourceEntry[];
  productTypeHeuristic: ProductTypeHeuristicResult | null;
}

/**
 * Build unified offer structure from parsed sections and metadata
 */
export function buildUnifiedOffer(
  sections: ParsedSection[],
  metadata: {
    documentId: string | undefined;
    fileName: string;
    calculationId?: string;
  },
  aiExtractedData?: any
): UnifiedOfferBuildResult {
  console.log('🔨 Builder: Constructing unified offer structure...');

  const missingFields: string[] = [];
  const sourcesMap = new Map<string, UnifiedOfferSourceEntry>();

  const registerSources = (sectionType: ParsedSection['type'], category: string) => {
    sections
      .filter(section => section.type === sectionType)
      .forEach(section => {
        const pageRangeKey = section.pageRange
          ? `${section.pageRange.start}-${section.pageRange.end}`
          : 'unknown';
        const key = `${category}:${pageRangeKey}:${section.snippet}`;
        if (!sourcesMap.has(key)) {
          sourcesMap.set(key, {
            category,
            sectionType,
            pageRange: section.pageRange,
            snippet: section.snippet,
            confidence: section.confidence
          });
        }
      });
  };

  // Extract offer_id from AI data or metadata
  const offerId = metadata.calculationId ||
                  aiExtractedData?.calculation_id ||
                  aiExtractedData?.calculationId ||
                  metadata.documentId;
  
  // Build insured array
  const insured = buildInsuredArray(sections, aiExtractedData, missingFields);
  registerSources('insured', 'insured');

  // Build contracts
  const baseContracts = buildBaseContracts(sections, aiExtractedData, missingFields);
  const additionalContracts = buildAdditionalContracts(sections, aiExtractedData, missingFields);
  registerSources('base_contract', 'base_contracts');
  registerSources('additional_contract', 'additional_contracts');

  // Extract discounts
  const discounts = extractDiscounts(sections, aiExtractedData);
  registerSources('discount', 'discounts');

  // Extract premiums
  const { beforeDiscounts, afterDiscounts } = extractPremiums(sections, aiExtractedData, missingFields);
  registerSources('premium', 'premiums');
  const paymentSchedule = extractPaymentSchedule(sections, aiExtractedData);
  registerSources('premium', 'payment_schedule');

  // Build assistance array
  const assistance = buildAssistanceArray(sections, aiExtractedData);
  registerSources('assistance', 'assistance');

  // Extract exclusions
  const exclusions = buildExclusions(sections, aiExtractedData);

  // Extract duration
  const duration = extractDuration(sections, aiExtractedData);
  registerSources('duration', 'duration');

  // Extract notes
  const notes = extractNotes(sections, aiExtractedData);

  // Calculate confidence
  const extractionConfidence = calculateConfidence(missingFields, sections);

  console.log(`✅ Builder: Offer structure complete (confidence: ${extractionConfidence})`);
  console.log(`📋 Missing fields: ${missingFields.length > 0 ? missingFields.join(', ') : 'none'}`);

  const offer: UnifiedOffer = {
    offer_id: offerId,
    source_document: metadata.fileName,
    insured,
    base_contracts: baseContracts,
    additional_contracts: additionalContracts,
    discounts,
    total_premium_before_discounts: beforeDiscounts,
    total_premium_after_discounts: afterDiscounts,
    payment_schedule: paymentSchedule,
    assistance,
    exclusions,
    duration,
    notes,
    missing_fields: missingFields,
    extraction_confidence: extractionConfidence
  };

  const heuristicFragments: string[] = [];
  if (typeof aiExtractedData?.product_type === 'string') {
    heuristicFragments.push(aiExtractedData.product_type);
  }
  if (typeof aiExtractedData?.productType === 'string') {
    heuristicFragments.push(aiExtractedData.productType);
  }
  if (Array.isArray(aiExtractedData?.base_contracts)) {
    for (const contract of aiExtractedData.base_contracts) {
      if (typeof contract?.name === 'string') {
        heuristicFragments.push(contract.name);
      }
    }
  }
  if (Array.isArray(aiExtractedData?.additional_contracts)) {
    for (const contract of aiExtractedData.additional_contracts) {
      if (typeof contract?.name === 'string') {
        heuristicFragments.push(contract.name);
      }
    }
  }
  sections.forEach(section => heuristicFragments.push(section.content));

  const heuristicInput = heuristicFragments.join(' | ').trim();
  const heuristicResult = heuristicInput.length > 0
    ? inferProductTypeFromText(heuristicInput, 'builder')
    : null;

  return {
    offer,
    sources: Array.from(sourcesMap.values()),
    productTypeHeuristic: heuristicResult
  };
}

function buildInsuredArray(
  sections: ParsedSection[],
  aiData: any,
  missingFields: string[]
): UnifiedOffer['insured'] {
  const insuredSections = sections.filter(s => s.type === 'insured');
  const insured: UnifiedOffer['insured'] = [];

  // Try to extract from AI data first
  if (aiData?.insured && Array.isArray(aiData.insured) && aiData.insured.length > 0) {
    return aiData.insured.map((person: any, personIndex: number) => {
      const ageValue = parseNumberValue(person.age);
      if (ageValue === null) {
        missingFields.push(`insured[${personIndex}].age`);
      }

      const plans = Array.isArray(person.plans)
        ? person.plans.map((plan: any, planIndex: number) => {
            const sumValue = parseNumberValue(plan.sum);
            if (sumValue === null) {
              missingFields.push(`insured[${personIndex}].plans[${planIndex}].sum`);
            }

            const premiumValue = parseNumberValue(plan.premium);
            if (premiumValue === null) {
              missingFields.push(`insured[${personIndex}].plans[${planIndex}].premium`);
            }

            return {
              type: plan.type || 'Nieznany plan',
              sum: sumValue ?? 'missing',
              premium: premiumValue ?? 'missing',
              variant: plan.variant || 'standard',
              duration: plan.duration || 'missing'
            };
          })
        : [];

      if (plans.length === 0) {
        missingFields.push(`insured[${personIndex}].plans`);
      }

      return {
        name: person.name || 'missing',
        age: ageValue ?? 'missing',
        role: person.role || 'ubezpieczony',
        plans
      };
    });
  }

  // Fallback: create at least one insured entry
  if (insuredSections.length === 0 && !aiData?.insured) {
    missingFields.push('insured');
    return [{
      name: 'missing',
      age: 'missing',
      role: 'ubezpieczony',
      plans: []
    }];
  }
  
  return insured;
}

function buildBaseContracts(
  sections: ParsedSection[],
  aiData: any,
  missingFields: string[]
): UnifiedOffer['base_contracts'] {
  // Prefer AI extraction for structured data
  if (aiData?.base_contracts && Array.isArray(aiData.base_contracts)) {
    return aiData.base_contracts.map((contract: any, index: number) => {
      const sumValue = parseNumberValue(contract.sum);
      if (sumValue === null) {
        missingFields.push(`base_contracts[${index}].sum`);
      }

      const premiumValue = parseNumberValue(contract.premium);
      if (premiumValue === null) {
        missingFields.push(`base_contracts[${index}].premium`);
      }

      return {
        name: contract.name || 'Umowa podstawowa',
        sum: sumValue ?? 'missing',
        premium: premiumValue ?? 'missing',
        variant: contract.variant || 'standard'
      };
    });
  }

  // Fallback to empty array
  return [];
}

function buildAdditionalContracts(
  sections: ParsedSection[],
  aiData: any,
  missingFields: string[]
): UnifiedOffer['additional_contracts'] {
  if (aiData?.additional_contracts && Array.isArray(aiData.additional_contracts)) {
    return aiData.additional_contracts.map((contract: any, index: number) => {
      const premiumValue = parseNumberValue(contract.premium);
      if (premiumValue === null) {
        missingFields.push(`additional_contracts[${index}].premium`);
      }

      return {
        name: contract.name || 'Umowa dodatkowa',
        coverage: contract.coverage || 'missing',
        premium: premiumValue ?? 'missing'
      };
    });
  }

  return [];
}

function extractDiscounts(sections: ParsedSection[], aiData: any): string[] {
  const discountSections = sections.filter(s => s.type === 'discount');
  const discounts: string[] = [];
  
  // Extract from AI data
  if (aiData?.discounts && Array.isArray(aiData.discounts)) {
    discounts.push(...aiData.discounts);
  }
  
  // Extract from text sections
  for (const section of discountSections) {
    const matches = section.content.match(/(?:zniżka|rabat|upust)[:\s]+([^\n]+)/gi);
    if (matches) {
      discounts.push(...matches.map(m => m.trim()));
    }
  }
  
  return [...new Set(discounts)]; // Remove duplicates
}

function extractPremiums(
  sections: ParsedSection[],
  aiData: any,
  missingFields: string[]
): { beforeDiscounts: number | 'missing'; afterDiscounts: number | 'missing' } {
  let beforeDiscounts: number | 'missing' = 'missing';
  let afterDiscounts: number | 'missing' = 'missing';

  // Try AI data first
  const beforeValue = parseNumberValue(aiData?.total_premium_before_discounts);
  if (beforeValue !== null) {
    beforeDiscounts = beforeValue;
  }

  const afterValue = parseNumberValue(aiData?.total_premium_after_discounts);
  if (afterValue !== null) {
    afterDiscounts = afterValue;
  } else {
    const legacyPremium = parseNumberValue(aiData?.premium?.total);
    if (legacyPremium !== null) {
      afterDiscounts = legacyPremium;
    }
  }
  
  if (beforeDiscounts === 'missing') {
    missingFields.push('total_premium_before_discounts');
  }
  
  if (afterDiscounts === 'missing') {
    missingFields.push('total_premium_after_discounts');
  }
  
  return { beforeDiscounts, afterDiscounts };
}

function buildAssistanceArray(
  sections: ParsedSection[],
  aiData: any
): UnifiedOffer['assistance'] {
  const assistanceSections = sections.filter(section => section.type === 'assistance');
  const fallbackLimits = assistanceSections.flatMap(section =>
    section.content.match(/limit[^\n]+/gi) ?? []
  );

  if (aiData?.assistance && Array.isArray(aiData.assistance)) {
    const normalized = aiData.assistance.map((service: any, index: number) => {
      if (typeof service === 'string') {
        return {
          name: service,
          coverage: 'opis niedostępny',
          limits: fallbackLimits[index] || 'brak danych',
          response_time: 'brak danych',
          contact: 'brak danych',
          exclusions: []
        };
      }

      const exclusions = Array.isArray(service.exclusions)
        ? service.exclusions.map((item: any) => String(item))
        : service.exclusions
          ? [String(service.exclusions)]
          : [];

      return {
        name: service.name || service.title || `Usługa assistance ${index + 1}`,
        coverage: service.coverage || service.description || 'brak danych',
        limits: service.limits || service.limit || fallbackLimits[index] || 'brak danych',
        response_time: service.response_time || service.response || 'brak danych',
        contact: service.contact || service.hotline || service.phone || 'brak danych',
        exclusions
      };
    });

    const uniqueByName = new Map<string, UnifiedOffer['assistance'][number]>();
    for (const item of normalized) {
      if (!uniqueByName.has(item.name)) {
        uniqueByName.set(item.name, item);
      }
    }

    const assistanceArray = Array.from(uniqueByName.values());
    if (assistanceArray.length > 0) {
      return assistanceArray;
    }
  }

  if (assistanceSections.length > 0) {
    return assistanceSections.map((section, index) => {
      const firstLine = section.content.split('\n')[0]?.trim() || `Usługa assistance ${index + 1}`;
      return {
        name: firstLine,
        coverage: section.content.slice(0, 180),
        limits: fallbackLimits[index] || 'brak danych',
        response_time: 'brak danych',
        contact: 'brak danych',
        exclusions: []
      };
    });
  }

  return [];
}

function buildExclusions(sections: ParsedSection[], aiData: any): UnifiedOffer['exclusions'] {
  const exclusions: UnifiedOffer['exclusions'] = [];
  const seen = new Set<string>();

  if (Array.isArray(aiData?.exclusions)) {
    for (const exclusion of aiData.exclusions) {
      if (typeof exclusion === 'string') {
        const key = exclusion.trim();
        if (!seen.has(key)) {
          seen.add(key);
          exclusions.push({
            name: key.slice(0, 80),
            description: key,
            keywords: []
          });
        }
      } else if (exclusion && typeof exclusion === 'object') {
        const name = exclusion.name || exclusion.title || 'Wyłączenie odpowiedzialności';
        const description = exclusion.description || exclusion.detail || 'brak szczegółów';
        const key = `${name}-${description}`;
        if (!seen.has(key)) {
          seen.add(key);
          exclusions.push({
            name,
            description,
            keywords: Array.isArray(exclusion.keywords) ? exclusion.keywords : []
          });
        }
      }
    }
  }

  const exclusionSections = sections.filter(section =>
    section.content.toLowerCase().includes('wyłącze') ||
    section.content.toLowerCase().includes('nie obejmuje') ||
    section.content.toLowerCase().includes('nie dotyczy')
  );

  for (const section of exclusionSections) {
    const sentences = section.content.split(/\n|\.\s/).map(sentence => sentence.trim()).filter(Boolean);
    for (const sentence of sentences) {
      const normalized = sentence.toLowerCase();
      if (normalized.includes('wyłącze') || normalized.includes('nie obejmuje') || normalized.includes('nie dotyczy')) {
        if (!seen.has(sentence)) {
          seen.add(sentence);
          exclusions.push({
            name: sentence.slice(0, 80) || 'Wyłączenie',
            description: sentence,
            keywords: section.keywords
          });
        }
      }
    }
  }

  return exclusions;
}

function extractDuration(sections: ParsedSection[], aiData: any): UnifiedOffer['duration'] {
  return {
    start: aiData?.valid_from || aiData?.duration?.start || 'missing',
    end: aiData?.valid_to || aiData?.duration?.end || 'missing',
    variant: aiData?.duration?.variant || 'standardowy'
  };
}

function extractNotes(sections: ParsedSection[], aiData: any): string[] {
  const notes: string[] = [];
  
  if (aiData?.notes && Array.isArray(aiData.notes)) {
    notes.push(...aiData.notes);
  }
  
  return notes;
}

function calculateConfidence(
  missingFields: string[],
  sections: ParsedSection[]
): 'high' | 'medium' | 'low' {
  const criticalFields = ['total_premium_after_discounts', 'insured'];
  const hasCriticalMissing = missingFields.some(f => criticalFields.includes(f));
  
  if (hasCriticalMissing) return 'low';
  if (missingFields.length > 3) return 'medium';
  
  // Check section identification rate
  const identifiedSections = sections.filter(s => s.type !== 'unknown').length;
  const ratio = sections.length > 0 ? identifiedSections / sections.length : 0;
  
  if (ratio > 0.7 && missingFields.length === 0) return 'high';
  if (ratio > 0.5) return 'medium';
  return 'low';
}
