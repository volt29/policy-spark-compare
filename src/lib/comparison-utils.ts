import type {
  ComparisonAnalysis,
  ComparisonAnalysisOffer,
  ComparisonAnalysisSection,
} from "@/types/comparison";

export interface ExtractedOfferData {
  insurer?: string | null;
  premium?: {
    total?: number | string | null;
    currency?: string | null;
  } | null;
  coverage?: {
    oc?: {
      sum?: number | string | null;
    } | null;
    ac?: {
      sum?: number | string | null;
    } | null;
  } | null;
  unified?: {
    offer_id?: string | null;
    total_premium_after_discounts?: number | string | "missing" | null;
    total_premium_before_discounts?: number | string | "missing" | null;
    assistance?: Array<string | { name?: string }> | null;
    duration?: {
      start?: string | "missing" | null;
      end?: string | "missing" | null;
      variant?: string | null;
    } | null;
    discounts?: Array<unknown> | null;
  } | null;
  assistance?: Array<string | { name?: string }> | null;
  deductible?: {
    amount?: number | string | null;
    currency?: string | null;
  } | null;
  [key: string]: unknown;
}

export interface ComparisonOffer {
  id: string;
  insurer: string;
  data: ExtractedOfferData | null;
  calculationId?: string | null;
}

export interface OfferBadges {
  "lowest-price": boolean;
  "highest-coverage": boolean;
  recommended: boolean;
  warning: boolean;
}

type OfferBadgeKey = keyof OfferBadges;

const indexKey = (index: number) => `index:${index}`;

const normalizeKey = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  return null;
};

const normalizeHighlight = (value: ComparisonAnalysisOffer["highlight"]):
  | "best"
  | "warning"
  | "neutral"
  | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const lowered = value.toLowerCase();
  if (lowered === "best" || lowered === "warning" || lowered === "neutral") {
    return lowered as "best" | "warning" | "neutral";
  }
  return undefined;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const createAnalysisLookup = (
  section?: ComparisonAnalysisSection | null,
): Map<string, ComparisonAnalysisOffer> => {
  const map = new Map<string, ComparisonAnalysisOffer>();
  const offers = section?.offers ?? [];

  offers.forEach((analysisOffer, idx) => {
    const keys = [
      normalizeKey(analysisOffer.offer_id),
      normalizeKey(analysisOffer.calculation_id),
      indexKey(idx),
    ].filter((key): key is string => Boolean(key));

    keys.forEach((key) => map.set(key, analysisOffer));
  });

  return map;
};

export const findOfferAnalysis = (
  lookup: Map<string, ComparisonAnalysisOffer>,
  offer: ComparisonOffer,
  index: number,
): ComparisonAnalysisOffer | undefined => {
  const keys = [
    normalizeKey(offer.calculationId),
    normalizeKey(offer.id),
    indexKey(index),
  ].filter((key): key is string => Boolean(key));

  for (const key of keys) {
    const match = lookup.get(key);
    if (match) {
      return match;
    }
  }

  return undefined;
};

export function analyzeBestOffers(
  offers: ComparisonOffer[],
  comparisonData: ComparisonAnalysis | null
): {
  badges: Map<string, OfferBadgeKey[]>;
  bestOfferIndex: number;
} {
  const badges = new Map<string, OfferBadgeKey[]>();
  let bestOfferIndex = -1;

  const premiums = offers.map((offer) => getPremium(offer.data));
  const lowestPremium = premiums.reduce<number>((acc, premium) => {
    if (premium !== null && (acc === Infinity || premium < acc)) {
      return premium;
    }
    return acc;
  }, Infinity);

  const coverages = offers.map((offer) => toNumber(offer.data?.coverage?.oc?.sum));
  const highestCoverage = coverages.reduce<number>((acc, coverage) => {
    if (coverage !== null && coverage > acc) {
      return coverage;
    }
    return acc;
  }, 0);

  const priceOffers = comparisonData?.price_comparison?.offers ?? [];
  const highlightLookup = new Map<string, ComparisonAnalysisOffer>();

  priceOffers.forEach((priceOffer, idx) => {
    const normalizedOfferId = normalizeKey(priceOffer.offer_id);
    const normalizedCalculationId = normalizeKey(priceOffer.calculation_id);
    const keys = [normalizedOfferId, normalizedCalculationId].filter(
      (key): key is string => Boolean(key)
    );

    if (keys.length === 0) {
      keys.push(indexKey(idx));
    }

    keys.forEach((key) => {
      highlightLookup.set(key, priceOffer);
    });
  });

  offers.forEach((offer, idx) => {
    const offerBadges: OfferBadgeKey[] = [];
    const premium = premiums[idx];
    const coverage = coverages[idx];

    if (premium !== null && premium === lowestPremium) {
      offerBadges.push("lowest-price");
    }

    if (coverage !== null && coverage === highestCoverage && coverage > 0) {
      offerBadges.push("highest-coverage");
    }

    const highlightCandidates = [
      normalizeKey(offer.calculationId),
      normalizeKey(offer.id),
      indexKey(idx),
    ].filter((candidate): candidate is string => Boolean(candidate));

    let matchedHighlight: ComparisonAnalysisOffer | undefined;
    for (const candidate of highlightCandidates) {
      const match = highlightLookup.get(candidate);
      if (match) {
        matchedHighlight = match;
        break;
      }
    }

    const highlight = normalizeHighlight(matchedHighlight?.highlight);
    if (highlight === "best") {
      offerBadges.push("recommended");
      bestOfferIndex = idx;
    } else if (highlight === "warning") {
      offerBadges.push("warning");
    }

    badges.set(offer.id, offerBadges);
  });

  if (bestOfferIndex === -1) {
    bestOfferIndex = premiums.findIndex((premium) => premium !== null && premium === lowestPremium);
  }

  return { badges, bestOfferIndex };
}

export function extractCalculationId(extractedData: ExtractedOfferData | null | undefined):
  | string
  | undefined {
  const unifiedId = extractedData?.unified?.offer_id;
  const normalizedUnified = normalizeKey(unifiedId);
  if (normalizedUnified) {
    return normalizedUnified;
  }

  const legacyId = (extractedData as Record<string, unknown> | null)?.calculation_id;
  const normalizedLegacy = normalizeKey(legacyId);
  if (normalizedLegacy) {
    return normalizedLegacy;
  }

  const camelLegacy = (extractedData as Record<string, unknown> | null)?.calculationId;
  const normalizedCamel = normalizeKey(camelLegacy);
  if (normalizedCamel) {
    return normalizedCamel;
  }

  return undefined;
}

/**
 * Get premium from extracted data (supports both old and new format)
 */
export function getPremium(extractedData: ExtractedOfferData | null | undefined): number | null {
  const unifiedPremium = extractedData?.unified?.total_premium_after_discounts;
  if (unifiedPremium === "missing") {
    return null;
  }
  const unifiedNumber = toNumber(unifiedPremium);
  if (unifiedNumber !== null) {
    return unifiedNumber;
  }

  const legacyPremium = extractedData?.premium?.total;
  const legacyNumber = toNumber(legacyPremium);
  if (legacyNumber !== null) {
    return legacyNumber;
  }

  return null;
}

/**
 * Check if data uses new unified format
 */
export function hasUnifiedFormat(extractedData: ExtractedOfferData | null | undefined): boolean {
  return Boolean(extractedData?.unified);
}
