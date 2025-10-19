import type { Database } from "@/integrations/supabase/types";

type Json = Database["public"]["Tables"]["comparisons"]["Row"]["comparison_data"];

type Primitive = string | number | boolean | null;
type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

export type ComparisonHighlight = "best" | "warning" | "neutral";

export interface ComparisonAnalysisOffer {
  offer_id?: string | number | null;
  calculation_id?: string | number | null;
  highlight?: ComparisonHighlight | string | null;
  note?: string | null;
  insurer?: string | null;
  value?: JsonValue;
}

export interface ComparisonAnalysisSection {
  offers?: ComparisonAnalysisOffer[] | null;
}

export interface ComparisonAnalysis extends Record<string, unknown> {
  price_comparison?: ComparisonAnalysisSection | null;
  coverage_comparison?: ComparisonAnalysisSection | null;
  assistance_comparison?: ComparisonAnalysisSection | null;
  exclusions_diff?: ComparisonAnalysisSection | null;
  key_highlights?: string[] | null;
  recommendations?: string[] | null;
  raw_text?: string | null;
  parse_error?: boolean | null;
}

export function toComparisonAnalysis(input: Json | null): ComparisonAnalysis | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const asRecord = input as Record<string, unknown>;

  const parseSection = (value: unknown): ComparisonAnalysisSection | null => {
    if (!value || typeof value !== "object") {
      return null;
    }

    const record = value as Record<string, unknown>;
    const offersValue = record.offers;

    if (!Array.isArray(offersValue)) {
      return { offers: [] };
    }

    const offers: ComparisonAnalysisOffer[] = offersValue
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const offerRecord = item as Record<string, unknown>;
        const highlight = offerRecord.highlight;
        return {
          offer_id: offerRecord.offer_id as ComparisonAnalysisOffer["offer_id"],
          calculation_id: offerRecord.calculation_id as ComparisonAnalysisOffer["calculation_id"],
          highlight: typeof highlight === "string" ? highlight : null,
          insurer: typeof offerRecord.insurer === "string" ? offerRecord.insurer : null,
          note: typeof offerRecord.note === "string" ? offerRecord.note : null,
          value: offerRecord.value as JsonValue,
        } satisfies ComparisonAnalysisOffer;
      })
      .filter((item): item is ComparisonAnalysisOffer => item !== null);

    return { offers };
  };

  const parseStringArray = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) {
      return null;
    }
    const strings = value.filter((entry): entry is string => typeof entry === "string");
    return strings.length > 0 ? strings : null;
  };

  const analysis: ComparisonAnalysis = {};

  const priceSection = parseSection(asRecord.price_comparison);
  if (priceSection) {
    analysis.price_comparison = priceSection;
  }

  const coverageSection = parseSection(asRecord.coverage_comparison);
  if (coverageSection) {
    analysis.coverage_comparison = coverageSection;
  }

  const assistanceSection = parseSection(asRecord.assistance_comparison);
  if (assistanceSection) {
    analysis.assistance_comparison = assistanceSection;
  }

  const exclusionsSection = parseSection(asRecord.exclusions_diff);
  if (exclusionsSection) {
    analysis.exclusions_diff = exclusionsSection;
  }

  const keyHighlights = parseStringArray(asRecord.key_highlights);
  if (keyHighlights) {
    analysis.key_highlights = keyHighlights;
  }

  const recommendations = parseStringArray(asRecord.recommendations);
  if (recommendations) {
    analysis.recommendations = recommendations;
  }

  if (typeof asRecord.raw_text === "string") {
    analysis.raw_text = asRecord.raw_text;
  }

  if (typeof asRecord.parse_error === "boolean") {
    analysis.parse_error = asRecord.parse_error;
  }

  return analysis;
}
