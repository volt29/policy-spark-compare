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
    payment_schedule?: {
      normalized_cycles?: Array<string> | null;
      raw_mentions?: Array<string> | null;
    } | null;
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

export type NormalizedPaymentCycle =
  | "monthly"
  | "annual"
  | "quarterly"
  | "semiannual"
  | "single"
  | "other";

export interface PaymentDisplayInfo {
  normalizedCycles: NormalizedPaymentCycle[];
  primaryLabel: string;
  secondaryLabels: string[];
  rawMentions: string[];
  hasData: boolean;
}

export interface RecommendedOfferContext {
  offerId?: string | null;
  calculationId?: string | null;
  insurer?: string | null;
  name?: string | null;
}

export interface ComparisonOffer {
  id: string;
  label: string;
  insurer: string | null;
  data: ExtractedOfferData | null;
  calculationId?: string | null;
  detectedProductType?: string | null;
  fileName?: string | null;
  previewUrl?: string | null;
  downloadUrl?: string | null;
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

const normalizeText = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
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

const PAYMENT_LABELS: Record<Exclude<NormalizedPaymentCycle, "other">, string> = {
  monthly: "miesięczna",
  annual: "roczna",
  quarterly: "kwartalna",
  semiannual: "półroczna",
  single: "jednorazowa",
};

const PAYMENT_REGEXES: Array<{ pattern: RegExp; cycle: Exclude<NormalizedPaymentCycle, "other"> }> = [
  { pattern: /(miesi[aą]c|co\s+miesi[aą]c|monthly|12\s*rat)/i, cycle: "monthly" },
  { pattern: /(roczn|co\s+rok|annual|yearly|12\s*miesi[aą]cy)/i, cycle: "annual" },
  { pattern: /(kwarta|quarter)/i, cycle: "quarterly" },
  { pattern: /(półroc|semi-?annual|co\s+pół\s+roku)/i, cycle: "semiannual" },
  { pattern: /(jednoraz|z\s+góry|single\s+payment)/i, cycle: "single" },
];

const detectNormalizedPaymentCycle = (value: string): NormalizedPaymentCycle | null => {
  for (const entry of PAYMENT_REGEXES) {
    if (entry.pattern.test(value)) {
      return entry.cycle;
    }
  }
  return null;
};

const normalizePaymentLabel = (cycle: NormalizedPaymentCycle, fallback?: string): string => {
  if (cycle !== "other") {
    return PAYMENT_LABELS[cycle] ?? fallback ?? cycle;
  }
  return fallback ?? "inna";
};

const collectPotentialPaymentValues = (value: unknown): string[] => {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPotentialPaymentValues(entry));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keysToInspect = [
      "frequency",
      "frequencies",
      "cycle",
      "cycles",
      "option",
      "options",
      "label",
      "name",
      "type",
      "billing_period",
      "payment_frequency",
      "paymentCycle",
      "payment_schedule",
      "plan",
    ];
    return keysToInspect.flatMap((key) => collectPotentialPaymentValues(record[key]));
  }
  return [];
};

export const getPaymentDisplayInfo = (
  extractedData: ExtractedOfferData | null | undefined,
): PaymentDisplayInfo => {
  const normalizedSet = new Set<NormalizedPaymentCycle>();
  const rawMentions = new Set<string>();

  const considerValue = (input: string) => {
    const cleaned = input.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      return;
    }
    rawMentions.add(cleaned);
    const detected = detectNormalizedPaymentCycle(cleaned.toLowerCase());
    if (detected) {
      normalizedSet.add(detected);
    }
  };

  const unifiedSchedule = extractedData?.unified?.payment_schedule;
  if (unifiedSchedule) {
    if (Array.isArray(unifiedSchedule.normalized_cycles)) {
      unifiedSchedule.normalized_cycles.forEach((cycle) => {
        if (typeof cycle === "string" && cycle.trim().length > 0) {
          const normalized = detectNormalizedPaymentCycle(cycle.toLowerCase()) ?? "other";
          normalizedSet.add(normalized);
        }
      });
    }
    if (Array.isArray(unifiedSchedule.raw_mentions)) {
      unifiedSchedule.raw_mentions
        .filter((mention): mention is string => typeof mention === "string")
        .forEach((mention) => considerValue(mention));
    }
  }

  const fallbackCandidates: unknown[] = [
    (extractedData as Record<string, unknown> | null)?.payment,
    extractedData?.premium && (extractedData.premium as Record<string, unknown>).payment_frequency,
    extractedData?.premium && (extractedData.premium as Record<string, unknown>).payment_schedule,
    (extractedData as Record<string, unknown> | null)?.payment_schedule,
  ];

  fallbackCandidates.forEach((candidate) => {
    collectPotentialPaymentValues(candidate).forEach((value) => considerValue(value));
  });

  const normalizedCycles = Array.from(normalizedSet);
  const rawList = Array.from(rawMentions);

  const normalizedLabels = normalizedCycles
    .filter((cycle) => cycle !== "other")
    .map((cycle) => normalizePaymentLabel(cycle as Exclude<NormalizedPaymentCycle, "other">));

  let primaryLabel = "—";
  let secondaryLabels: string[] = [];

  if (normalizedLabels.length === 1 && rawList.length <= 1) {
    primaryLabel = normalizedLabels[0];
  } else if (normalizedLabels.length > 1) {
    primaryLabel = "różne";
    secondaryLabels = [...new Set(normalizedLabels)];
  } else if (rawList.length === 1) {
    primaryLabel = rawList[0];
  } else if (rawList.length > 1) {
    primaryLabel = "różne";
    secondaryLabels = [...new Set(rawList)];
  }

  if (secondaryLabels.length === 0 && normalizedLabels.length === 1 && rawList.length > 1) {
    secondaryLabels = [...new Set(rawList.filter((entry) => entry !== primaryLabel))];
  }

  secondaryLabels = secondaryLabels.filter((label) => label && label !== primaryLabel);

  return {
    normalizedCycles,
    primaryLabel,
    secondaryLabels,
    rawMentions: rawList,
    hasData: normalizedCycles.length > 0 || rawList.length > 0,
  } satisfies PaymentDisplayInfo;
};

const resolveRecommendedOfferIndex = (
  offers: ComparisonOffer[],
  context?: RecommendedOfferContext | null,
): number => {
  if (!context) {
    return -1;
  }

  const normalizedOfferId = normalizeKey(context.offerId);
  const normalizedCalculationId = normalizeKey(context.calculationId);
  const normalizedInsurer = normalizeText(context.insurer);
  const normalizedName = normalizeText(context.name);

  let bestScore = 0;
  let bestIndex = -1;

  offers.forEach((offer, idx) => {
    let score = 0;

    const offerId = normalizeKey(offer.id);
    const offerCalcId = normalizeKey(offer.calculationId);
    const offerInsurer = normalizeText(offer.insurer);
    const offerLabel = normalizeText(offer.label);
    const unifiedOfferId = normalizeKey(offer.data?.unified?.offer_id);

    if (normalizedOfferId && offerId && normalizedOfferId === offerId) {
      score += 8;
    }
    if (normalizedCalculationId && offerCalcId && normalizedCalculationId === offerCalcId) {
      score += 8;
    }
    if (normalizedInsurer && offerInsurer && normalizedInsurer === offerInsurer) {
      score += 4;
    }

    if (normalizedName) {
      if (offerLabel && offerLabel.includes(normalizedName)) {
        score += 3;
      }
      if (unifiedOfferId && normalizedName === unifiedOfferId.toLowerCase()) {
        score += 4;
      }
      const productName = normalizeText((offer.data as Record<string, unknown> | null)?.product_name);
      if (productName && productName.includes(normalizedName)) {
        score += 2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = idx;
    }
  });

  return bestScore > 0 ? bestIndex : -1;
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
  comparisonData: ComparisonAnalysis | null,
  recommendedContext?: RecommendedOfferContext | null,
): {
  badges: Map<string, OfferBadgeKey[]>;
  bestOfferIndex: number;
} {
  const badges = new Map<string, OfferBadgeKey[]>();
  let bestOfferIndex = resolveRecommendedOfferIndex(offers, recommendedContext);

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
    if (highlight === "warning") {
      offerBadges.push("warning");
    }

    if (bestOfferIndex === -1 && highlight === "best") {
      bestOfferIndex = idx;
      offerBadges.push("recommended");
    } else if (bestOfferIndex === idx) {
      offerBadges.push("recommended");
    }

    badges.set(offer.id, offerBadges);
  });

  if (bestOfferIndex === -1) {
    bestOfferIndex = premiums.findIndex((premium) => premium !== null && premium === lowestPremium);
    if (bestOfferIndex >= 0) {
      const badgesForBest = badges.get(offers[bestOfferIndex].id) ?? [];
      badgesForBest.push("recommended");
      badges.set(offers[bestOfferIndex].id, badgesForBest);
    }
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
