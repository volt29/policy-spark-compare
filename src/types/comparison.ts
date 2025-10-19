import type { Database } from "@/integrations/supabase/types";

type Json = Database["public"]["Tables"]["comparisons"]["Row"]["comparison_data"];

type Primitive = string | number | boolean | null;
type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  return null;
};

const parseCoordinates = (value: unknown): SourceReferenceCoordinates | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const x = toNumber(record.x);
  const y = toNumber(record.y);
  const width = toNumber(record.width);
  const height = toNumber(record.height);

  if (x === null || y === null || width === null || height === null) {
    return undefined;
  }

  return { x, y, width, height } satisfies SourceReferenceCoordinates;
};

const parseSingleSourceReference = (value: unknown): SourceReference | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const documentId =
    normalizeString(record.documentId ?? record.document_id ?? record.document ?? record.source_document) ?? null;
  const pageValue =
    toNumber(record.page ?? record.pageNumber ?? record.page_index ?? record.pageIndex ?? record.index) ?? null;
  const textSnippet =
    normalizeString(record.textSnippet ?? record.text_snippet ?? record.snippet ?? record.text ?? record.content) ?? null;

  if (!documentId || pageValue === null || !textSnippet) {
    return null;
  }

  const coordinates = parseCoordinates(record.coordinates ?? record.bounding_box ?? record.bounds);

  return {
    documentId,
    page: Math.max(1, Math.floor(pageValue)),
    textSnippet,
    ...(coordinates ? { coordinates } : {}),
  } satisfies SourceReference;
};

const parseSourceReferences = (value: unknown): SourceReference[] | null => {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    const references = value
      .map((entry) => parseSingleSourceReference(entry))
      .filter((entry): entry is SourceReference => entry !== null);
    return references.length > 0 ? references : null;
  }

  const single = parseSingleSourceReference(value);
  return single ? [single] : null;
};

export type ComparisonHighlight = "best" | "warning" | "neutral";

export interface SourceReferenceCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceReference {
  documentId: string;
  page: number;
  textSnippet: string;
  coordinates?: SourceReferenceCoordinates;
}

export interface ComparisonAnalysisOffer {
  offer_id?: string | number | null;
  calculation_id?: string | number | null;
  highlight?: ComparisonHighlight | string | null;
  note?: string | null;
  insurer?: string | null;
  value?: JsonValue;
  sources?: SourceReference[] | null;
}

export interface ComparisonAnalysisSection {
  offers?: ComparisonAnalysisOffer[] | null;
}

export interface ComparisonSummaryKeyNumber {
  label: string;
  value: string;
  sources?: SourceReference[] | null;
}

export interface ComparisonSummaryRecommendedOffer {
  name?: string | null;
  insurer?: string | null;
  summary?: string | null;
  key_numbers?: ComparisonSummaryKeyNumber[] | null;
}

export interface ComparisonSummary {
  recommended_offer?: ComparisonSummaryRecommendedOffer | null;
  reasons?: string[] | null;
  risks?: string[] | null;
  next_steps?: string[] | null;
  sources_map?: Record<string, unknown> | null;
  fallback_text?: string | null;
  raw_text?: string | null;
  parse_error?: boolean | null;
}

export interface ComparisonAnalysis extends Record<string, unknown> {
  price_comparison?: ComparisonAnalysisSection | null;
  coverage_comparison?: ComparisonAnalysisSection | null;
  assistance_comparison?: ComparisonAnalysisSection | null;
  exclusions_diff?: ComparisonAnalysisSection | null;
  key_highlights?: string[] | null;
  recommendations?: string[] | null;
  summary?: ComparisonSummary | null;
  raw_text?: string | null;
  parse_error?: boolean | null;
}

export function toComparisonAnalysis(
  input: Json | null,
  summaryInput?: unknown,
): ComparisonAnalysis | null {
  const analysis: ComparisonAnalysis = {};

  const parseStringArray = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) {
      return null;
    }
    const strings = value.filter((entry): entry is string => typeof entry === "string");
    return strings.length > 0 ? strings : null;
  };

  let asRecord: Record<string, unknown> | null = null;

  if (input && typeof input === "object") {
    asRecord = input as Record<string, unknown>;

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
          const sources =
            parseSourceReferences(
              offerRecord.source_reference ??
                offerRecord.source_references ??
                offerRecord.source ??
                offerRecord.sources,
            ) ?? null;
          return {
            offer_id: offerRecord.offer_id as ComparisonAnalysisOffer["offer_id"],
            calculation_id: offerRecord.calculation_id as ComparisonAnalysisOffer["calculation_id"],
            highlight: typeof highlight === "string" ? highlight : null,
            insurer: typeof offerRecord.insurer === "string" ? offerRecord.insurer : null,
            note: typeof offerRecord.note === "string" ? offerRecord.note : null,
            value: offerRecord.value as JsonValue,
            sources,
          } satisfies ComparisonAnalysisOffer;
        })
        .filter((item): item is ComparisonAnalysisOffer => item !== null);

      return { offers };
    };

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
  }

  const parseSummaryKeyNumbers = (
    value: unknown,
  ): ComparisonSummaryKeyNumber[] | null => {
    if (!Array.isArray(value)) {
      return null;
    }

    const metrics = value
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        const label = typeof record.label === "string" ? record.label.trim() : null;
        const metricValue = typeof record.value === "string" ? record.value.trim() : null;
        if (!label || !metricValue) {
          return null;
        }
        const sources =
          parseSourceReferences(
            record.source_reference ?? record.source_references ?? record.source ?? record.sources,
          ) ?? null;
        return { label, value: metricValue, sources } satisfies ComparisonSummaryKeyNumber;
      })
      .filter((item): item is ComparisonSummaryKeyNumber => item !== null);

    return metrics.length > 0 ? metrics : null;
  };

  const parseRecommendedOffer = (
    value: unknown,
  ): ComparisonSummaryRecommendedOffer | null => {
    if (!value || typeof value !== "object") {
      return null;
    }

    const record = value as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : null;
    const insurer = typeof record.insurer === "string" ? record.insurer.trim() : null;
    const summary = typeof record.summary === "string" ? record.summary.trim() : null;
    const keyNumbers = parseSummaryKeyNumbers(record.key_numbers ?? record.key_metrics);

    if (!name && !insurer && !summary && !keyNumbers) {
      return null;
    }

    const recommended: ComparisonSummaryRecommendedOffer = {};
    if (name) recommended.name = name;
    if (insurer) recommended.insurer = insurer;
    if (summary) recommended.summary = summary;
    if (keyNumbers) recommended.key_numbers = keyNumbers;

    return recommended;
  };

  const parseSummaryRecord = (value: unknown): ComparisonSummary | null => {
    if (!value || typeof value !== "object") {
      return null;
    }

    const record = value as Record<string, unknown>;
    const summary: ComparisonSummary = {};

    const recommendedOffer = parseRecommendedOffer(record.recommended_offer);
    if (recommendedOffer) {
      summary.recommended_offer = recommendedOffer;
    }

    const reasons = parseStringArray(record.reasons);
    if (reasons) {
      summary.reasons = reasons;
    }

    const risks = parseStringArray(record.risks);
    if (risks) {
      summary.risks = risks;
    }
  const exclusionsSection = parseSection(asRecord.exclusions_diff);
  if (exclusionsSection) {
    analysis.exclusions_diff = exclusionsSection;
  }

  const keyHighlights = parseStringArray(asRecord.key_highlights);
  if (keyHighlights) {
    analysis.key_highlights = keyHighlights;
  }

    const nextSteps = parseStringArray(record.next_steps);
    if (nextSteps) {
      summary.next_steps = nextSteps;
    }

    const sourcesValue = record.sources_map ?? record.sources ?? record.citations;
    if (sourcesValue && typeof sourcesValue === "object") {
      if (Array.isArray(sourcesValue)) {
        const entries = sourcesValue
          .map((entry, index) => {
            if (!entry || typeof entry !== "object") {
              return null;
            }
            const key = String(index + 1);
            return [key, entry as Record<string, unknown>];
          })
          .filter((entry): entry is [string, Record<string, unknown>] => entry !== null);

        if (entries.length > 0) {
          summary.sources_map = Object.fromEntries(entries);
        }
      } else {
        summary.sources_map = sourcesValue as Record<string, unknown>;
      }
    }

    if (typeof record.fallback_text === "string" && record.fallback_text.trim().length > 0) {
      summary.fallback_text = record.fallback_text.trim();
    }

    if (typeof record.raw_text === "string" && record.raw_text.trim().length > 0) {
      summary.raw_text = record.raw_text.trim();
    }

    if (typeof record.summary_text === "string" && record.summary_text.trim().length > 0) {
      summary.raw_text ??= record.summary_text.trim();
      summary.fallback_text ??= record.summary_text.trim();
    }

    if (typeof record.parse_error === "boolean") {
      summary.parse_error = record.parse_error;
    }

    return Object.keys(summary).length > 0 ? summary : null;
  };

  const parseSummaryInput = (value: unknown): ComparisonSummary | null => {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      try {
        const parsed = JSON.parse(trimmed);
        const summary = parseSummaryRecord(parsed);
        if (summary) {
          if (!summary.raw_text && typeof parsed.raw_text === "string") {
            const rawText = parsed.raw_text.trim();
            if (rawText) {
              summary.raw_text = rawText;
            }
          }
          if (!summary.fallback_text && typeof parsed.fallback_text === "string") {
            const fallback = parsed.fallback_text.trim();
            if (fallback) {
              summary.fallback_text = fallback;
            }
          }
          if (typeof parsed.parse_error === "boolean") {
            summary.parse_error = parsed.parse_error;
          }
          summary.fallback_text ??= summary.raw_text ?? trimmed;
          summary.raw_text ??= trimmed;
          return summary;
        }
      } catch {
        // fall through to return legacy text format
      }

      return { fallback_text: trimmed, raw_text: trimmed, parse_error: true } satisfies ComparisonSummary;
    }

    const summary = parseSummaryRecord(value);
    if (!summary) {
      return null;
    }

    const record = value as Record<string, unknown>;
    if (!summary.raw_text && typeof record.raw_text === "string") {
      const rawText = record.raw_text.trim();
      if (rawText) {
        summary.raw_text = rawText;
      }
    }
    if (!summary.fallback_text && typeof record.fallback_text === "string") {
      const fallback = record.fallback_text.trim();
      if (fallback) {
        summary.fallback_text = fallback;
      }
    }
    if (typeof record.parse_error === "boolean") {
      summary.parse_error = record.parse_error;
    }
    summary.fallback_text ??= summary.raw_text ?? null;

    return summary;
  };

  const summaryFromInput =
    parseSummaryInput(summaryInput) ?? (asRecord ? parseSummaryInput(asRecord.summary) : null);

  if (summaryFromInput) {
    analysis.summary = summaryFromInput;
  }

  return Object.keys(analysis).length > 0 ? analysis : null;
}
