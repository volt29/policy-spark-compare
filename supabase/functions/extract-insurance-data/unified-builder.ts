// Unified JSON Builder - constructs standardized offer structure

import { ParsedSection } from './classifier.ts';

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
  assistance: Array<{
    name: string;
    coverage: string;
    limits: string;
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
): UnifiedOffer {
  console.log('🔨 Builder: Constructing unified offer structure...');
  
  const missingFields: string[] = [];
  
  // Extract offer_id from AI data or metadata
  const offerId = metadata.calculationId || 
                  aiExtractedData?.calculation_id || 
                  aiExtractedData?.calculationId ||
                  metadata.documentId;
  
  // Build insured array
  const insured = buildInsuredArray(sections, aiExtractedData, missingFields);

  // Build contracts
  const baseContracts = buildBaseContracts(sections, aiExtractedData, missingFields);
  const additionalContracts = buildAdditionalContracts(sections, aiExtractedData, missingFields);
  
  // Extract discounts
  const discounts = extractDiscounts(sections, aiExtractedData);
  
  // Extract premiums
  const { beforeDiscounts, afterDiscounts } = extractPremiums(sections, aiExtractedData, missingFields);
  
  // Build assistance array
  const assistance = buildAssistanceArray(sections, aiExtractedData);
  
  // Extract duration
  const duration = extractDuration(sections, aiExtractedData);
  
  // Extract notes
  const notes = extractNotes(sections, aiExtractedData);
  
  // Calculate confidence
  const extractionConfidence = calculateConfidence(missingFields, sections);
  
  console.log(`✅ Builder: Offer structure complete (confidence: ${extractionConfidence})`);
  console.log(`📋 Missing fields: ${missingFields.length > 0 ? missingFields.join(', ') : 'none'}`);
  
  return {
    offer_id: offerId,
    source_document: metadata.fileName,
    insured,
    base_contracts: baseContracts,
    additional_contracts: additionalContracts,
    discounts,
    total_premium_before_discounts: beforeDiscounts,
    total_premium_after_discounts: afterDiscounts,
    assistance,
    duration,
    notes,
    missing_fields: missingFields,
    extraction_confidence: extractionConfidence
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
  if (aiData?.assistance && Array.isArray(aiData.assistance)) {
    // Check if already in new format
    if (aiData.assistance.length > 0 && typeof aiData.assistance[0] === 'object' && aiData.assistance[0].name) {
      return aiData.assistance;
    }
    
    // Convert from old format (array of strings)
    return aiData.assistance.map((service: string) => ({
      name: service,
      coverage: '24/7',
      limits: 'standardowe'
    }));
  }
  
  return [];
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
