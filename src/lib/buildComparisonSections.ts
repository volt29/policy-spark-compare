import { getPremium, type ComparisonOffer } from "@/lib/comparison-utils";
import { formatValueWithUnit, normalizeCurrencyCode } from "@/lib/valueFormatters";
import type {
  ComparisonAnalysis,
  ComparisonAnalysisOffer,
  ComparisonAnalysisSection,
} from "@/types/comparison";

export type HighlightTone = "best" | "warning" | "neutral" | undefined;

export type ComparisonDiffStatus = "equal" | "different" | "partial" | "missing";

export interface ComparisonSectionSourceEntry {
  offerId?: string;
  calculationId?: string;
  source?: string | null;
  normalization?: string | null;
  unit?: string | null;
  note?: string | null;
}

export interface ComparisonSectionSource {
  id: string;
  label: string;
  entries: ComparisonSectionSourceEntry[];
}

export interface ComparisonSourceMetadataEntry {
  offer_id?: string | number | null;
  document_id?: string | number | null;
  calculation_id?: string | number | null;
  index?: number | null;
  source?: string | null;
  normalization?: string | null;
  unit?: string | null;
  note?: string | null;
}

export interface ComparisonSourceMetadataRow {
  label?: string | null;
  entries: ComparisonSourceMetadataEntry[];
}

export type ComparisonSourceMetadata = Record<string, ComparisonSourceMetadataRow | undefined>;

export interface ComparisonValueCell {
  offerId: string;
  formattedValue: string | null;
  rawValue: unknown;
  tooltip?: string | null;
  normalizedValue?: number | null;
  signature?: string | null;
  items?: string[];
  highlight?: HighlightTone;
  aiMessages: string[];
  isMissing: boolean;
}

export type ComparisonSectionRowType = "metric" | "list";

export interface ComparisonSectionRow {
  id: string;
  label: string;
  type: ComparisonSectionRowType;
  icon?: string;
  analysisLabel?: string;
  aiFallbackMessage?: string;
  values: ComparisonValueCell[];
  diffStatus: ComparisonDiffStatus;
}

export interface ComparisonSection {
  id: string;
  title: string;
  icon?: string;
  rows: ComparisonSectionRow[];
  diffStatus: ComparisonDiffStatus;
  sources: ComparisonSectionSource[];
  defaultExpanded?: boolean;
}

const normalizeKey = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  return null;
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

const collectTextMessages = (value: unknown): string[] => {
  if (!value) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTextMessages(entry)).filter(Boolean);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .flatMap((entry) => collectTextMessages(entry))
      .filter(Boolean);
  }
  return [];
};

const getAiMessages = (analysis?: ComparisonAnalysisOffer): string[] => {
  if (!analysis) return [];
  const messages: string[] = [];

  if (typeof analysis.note === "string" && analysis.note.trim().length > 0) {
    messages.push(analysis.note.trim());
  }

  const valueMessages = collectTextMessages(analysis.value);
  valueMessages.forEach((message) => {
    if (!messages.includes(message)) {
      messages.push(message);
    }
  });

  return messages;
};

const createAnalysisLookup = (
  section?: ComparisonAnalysisSection | null,
): Map<string, ComparisonAnalysisOffer> => {
  const map = new Map<string, ComparisonAnalysisOffer>();
  const offers = section?.offers ?? [];
  offers.forEach((analysisOffer, idx) => {
    const keys = [
      normalizeKey(analysisOffer.offer_id),
      normalizeKey(analysisOffer.calculation_id),
      `index:${idx}`,
    ].filter((key): key is string => Boolean(key));

    keys.forEach((key) => map.set(key, analysisOffer));
  });
  return map;
};

const getOfferAnalysis = (
  lookup: Map<string, ComparisonAnalysisOffer>,
  offer: ComparisonOffer,
  index: number,
): ComparisonAnalysisOffer | undefined => {
  const keys = [
    normalizeKey(offer.calculationId),
    normalizeKey(offer.id),
    `index:${index}`,
  ].filter((key): key is string => Boolean(key));

  for (const key of keys) {
    const match = lookup.get(key);
    if (match) {
      return match;
    }
  }
  return undefined;
};

const getPriceMetrics = (analysis?: ComparisonAnalysisOffer) => {
  if (!analysis) {
    return { delta: null as number | null, percent: null as number | null };
  }

  const value = analysis.value;
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

  const deltaKeys = [
    "delta_vs_average",
    "difference_vs_average",
    "difference_from_average",
    "delta",
  ];
  const percentKeys = [
    "percent_vs_average",
    "percentage_vs_average",
    "percent_difference",
    "percentage_difference",
    "percent",
  ];

  let delta: number | null = null;
  let percent: number | null = null;

  if (record) {
    for (const key of deltaKeys) {
      const candidate = record[key];
      const numeric = toNumber(candidate);
      if (numeric !== null) {
        delta = numeric;
        break;
      }
    }

    for (const key of percentKeys) {
      const candidate = record[key];
      const numeric = toNumber(candidate);
      if (numeric !== null) {
        percent = numeric;
        break;
      }
    }
  }

  return { delta, percent };
};

const formatPercent = (value: number) => {
  const formatted = value.toLocaleString("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  return value > 0 ? `+${formatted}%` : `${formatted}%`;
};

const calculateRowDiffStatus = (values: ComparisonValueCell[]): ComparisonDiffStatus => {
  const hasValue = values.some((cell) => !cell.isMissing);
  if (!hasValue) {
    return "missing";
  }

  const signatures = new Set<string>();
  let hasMissing = false;

  values.forEach((cell) => {
    if (cell.isMissing) {
      hasMissing = true;
      return;
    }

    if (cell.normalizedValue !== undefined && cell.normalizedValue !== null) {
      signatures.add(`num:${cell.normalizedValue}`);
      return;
    }

    if (cell.signature) {
      signatures.add(`sig:${cell.signature}`);
      return;
    }

    if (cell.formattedValue) {
      signatures.add(`txt:${cell.formattedValue.toLowerCase()}`);
      return;
    }

    if (cell.items && cell.items.length > 0) {
      signatures.add(`list:${cell.items.join("|").toLowerCase()}`);
    }
  });

  if (signatures.size <= 1) {
    return hasMissing ? "partial" : "equal";
  }
  return "different";
};

const mergeSectionStatus = (
  current: ComparisonDiffStatus,
  next: ComparisonDiffStatus,
): ComparisonDiffStatus => {
  const priority: ComparisonDiffStatus[] = ["missing", "equal", "partial", "different"];
  return priority.indexOf(next) > priority.indexOf(current) ? next : current;
};

const getOfferCurrency = (offer: ComparisonOffer): string => {
  const legacyCurrency = offer.data?.premium?.currency;
  if (typeof legacyCurrency === "string" && legacyCurrency.trim().length > 0) {
    return normalizeCurrencyCode(legacyCurrency);
  }
  return "PLN";
};

const normalizeListItems = (items: unknown[]): string[] =>
  items
    .map((entry) => {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const candidates = ["name", "title", "coverage", "description"] as const;
        for (const key of candidates) {
          const value = record[key];
          if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
          }
        }
        return "Brak opisu";
      }
      return null;
    })
    .filter((item): item is string => Boolean(item));

const buildListSignature = (items: string[]): string | null => {
  if (items.length === 0) return null;
  const normalized = [...items].sort((a, b) => a.localeCompare(b));
  return normalized.join("|").toLowerCase();
};

const mapSourceMetadata = (
  metadata?: ComparisonSourceMetadata | null,
): Map<string, ComparisonSourceMetadataRow> => {
  const map = new Map<string, ComparisonSourceMetadataRow>();
  if (!metadata || typeof metadata !== "object") {
    return map;
  }

  Object.entries(metadata).forEach(([key, value]) => {
    if (!value || typeof value !== "object") {
      return;
    }

    const rowValue = value as ComparisonSourceMetadataRow;
    const entries = Array.isArray(rowValue.entries)
      ? rowValue.entries
          .map((entry) => {
            if (!entry || typeof entry !== "object") {
              return null;
            }
            const candidate = entry as ComparisonSourceMetadataEntry;
            return {
              offer_id: candidate.offer_id ?? candidate.document_id ?? null,
              document_id: candidate.document_id ?? null,
              calculation_id: candidate.calculation_id ?? null,
              index: typeof candidate.index === "number" ? candidate.index : null,
              source: candidate.source ?? null,
              normalization: candidate.normalization ?? null,
              unit: candidate.unit ?? null,
              note: candidate.note ?? null,
            } satisfies ComparisonSourceMetadataEntry;
          })
          .filter((entry) => entry !== null && entry !== undefined) as ComparisonSourceMetadataEntry[]
      : [];

    map.set(key, {
      label: typeof rowValue.label === "string" ? rowValue.label : null,
      entries,
    });
  });

  return map;
};

const matchSourceEntry = (
  rowSource: ComparisonSourceMetadataRow | undefined,
  offer: ComparisonOffer,
  index: number,
): ComparisonSourceMetadataEntry | undefined => {
  if (!rowSource) return undefined;
  const entries = rowSource.entries ?? [];
  const offerKeys = [normalizeKey(offer.id), normalizeKey(offer.calculationId), `index:${index}`];

  return entries.find((entry) => {
    const candidateKeys = [
      normalizeKey(entry.offer_id),
      normalizeKey(entry.document_id),
      normalizeKey(entry.calculation_id),
      typeof entry.index === "number" ? `index:${entry.index}` : null,
    ].filter((value): value is string => Boolean(value));

    if (candidateKeys.length === 0) {
      return true;
    }

    return candidateKeys.some((key) => offerKeys.includes(key));
  });
};

const transformRowSource = (
  rowId: string,
  rowLabel: string,
  rowSource?: ComparisonSourceMetadataRow,
): ComparisonSectionSource | null => {
  if (!rowSource) {
    return null;
  }

  const entries: ComparisonSectionSourceEntry[] = (rowSource.entries ?? []).map((entry) => ({
    offerId: entry.offer_id ? String(entry.offer_id) : undefined,
    calculationId: entry.calculation_id ? String(entry.calculation_id) : undefined,
    source: entry.source ?? null,
    normalization: entry.normalization ?? null,
    unit: entry.unit ?? null,
    note: entry.note ?? null,
  }));

  return {
    id: rowId,
    label: rowSource.label ?? rowLabel,
    entries,
  };
};

export const buildComparisonSections = (
  offers: ComparisonOffer[],
  comparisonAnalysis: ComparisonAnalysis | null,
  sourceMetadata?: ComparisonSourceMetadata | null,
): ComparisonSection[] => {
  const metadataMap = mapSourceMetadata(sourceMetadata);

  const priceLookup = createAnalysisLookup(comparisonAnalysis?.price_comparison);
  const coverageLookup = createAnalysisLookup(comparisonAnalysis?.coverage_comparison);
  const assistanceLookup = createAnalysisLookup(comparisonAnalysis?.assistance_comparison);
  const exclusionsLookup = createAnalysisLookup(comparisonAnalysis?.exclusions_diff);

  const priceAnalyses = offers.map((offer, idx) => getOfferAnalysis(priceLookup, offer, idx));
  const coverageAnalyses = offers.map((offer, idx) => getOfferAnalysis(coverageLookup, offer, idx));
  const assistanceAnalyses = offers.map((offer, idx) => getOfferAnalysis(assistanceLookup, offer, idx));
  const exclusionsAnalyses = offers.map((offer, idx) => getOfferAnalysis(exclusionsLookup, offer, idx));

  const currencies = offers.map((offer) => getOfferCurrency(offer));

  const sections: ComparisonSection[] = [];

  // Price section
  const priceSources: ComparisonSectionSource[] = [];

  const priceRows: ComparisonSectionRow[] = [];
  const totalPremiumSource = metadataMap.get("price.total");
  const totalPremiumRow: ComparisonSectionRow = {
    id: "price.total",
    label: "Składka całkowita",
    type: "metric",
    icon: "price",
    analysisLabel: "Analiza AI",
    aiFallbackMessage: "Brak komentarza AI",
    values: offers.map((offer, idx) => {
      const premium = getPremium(offer.data);
      const sourceEntry = matchSourceEntry(totalPremiumSource, offer, idx);
      const formatted = premium !== null
        ? formatValueWithUnit(premium, {
            type: "currency",
            unit: sourceEntry?.unit ?? currencies[idx],
            source: sourceEntry?.source ?? totalPremiumSource?.label ?? null,
            normalization: sourceEntry?.normalization ?? currencies[idx],
            note: sourceEntry?.note ?? null,
          })
        : {
            displayValue: null,
            normalizedValue: null,
            tooltip: sourceEntry?.source
              ? `Źródło: ${sourceEntry.source}`
              : null,
            isNumeric: false,
            unit: sourceEntry?.unit,
          };
      const highlight = priceAnalyses[idx]?.highlight as HighlightTone;
      return {
        offerId: offer.id,
        formattedValue: formatted.displayValue,
        normalizedValue: formatted.normalizedValue ?? undefined,
        rawValue: premium,
        tooltip: formatted.tooltip,
        highlight,
        aiMessages: getAiMessages(priceAnalyses[idx]),
        isMissing: premium === null,
      } satisfies ComparisonValueCell;
    }),
    diffStatus: "missing",
  };
  totalPremiumRow.diffStatus = calculateRowDiffStatus(totalPremiumRow.values);
  priceRows.push(totalPremiumRow);

  const deltaSource = metadataMap.get("price.delta");
  const deltaRow: ComparisonSectionRow = {
    id: "price.delta",
    label: "Odchylenie od średniej",
    type: "metric",
    icon: "delta",
    analysisLabel: "Komentarz AI",
    aiFallbackMessage: "Brak komentarza AI",
    values: offers.map((offer, idx) => {
      const metrics = getPriceMetrics(priceAnalyses[idx]);
      const sourceEntry = matchSourceEntry(deltaSource, offer, idx);

      const parts: string[] = [];
      let normalized: number | null = null;

      if (metrics.delta !== null) {
        const formattedDelta = formatValueWithUnit(metrics.delta, {
          type: "currency",
          unit: sourceEntry?.unit ?? currencies[idx],
          source: sourceEntry?.source ?? deltaSource?.label ?? null,
          normalization: sourceEntry?.normalization ?? currencies[idx],
          note: sourceEntry?.note ?? null,
        });
        if (formattedDelta.displayValue) {
          parts.push(formattedDelta.displayValue);
        }
        normalized = formattedDelta.normalizedValue;
      }

      if (metrics.percent !== null) {
        parts.push(formatPercent(metrics.percent));
        if (normalized === null) {
          normalized = metrics.percent;
        }
      }

      const valueText = parts.join("\n");
      const highlight = priceAnalyses[idx]?.highlight as HighlightTone;

      return {
        offerId: offer.id,
        formattedValue: valueText || null,
        normalizedValue: normalized ?? undefined,
        rawValue: metrics,
        tooltip: sourceEntry?.source
          ? formatValueWithUnit(metrics.delta, {
              type: "currency",
              unit: sourceEntry?.unit ?? currencies[idx],
              source: sourceEntry?.source ?? deltaSource?.label ?? null,
              normalization: sourceEntry?.normalization ?? currencies[idx],
              note: sourceEntry?.note ?? null,
            }).tooltip
          : null,
        highlight,
        aiMessages: getAiMessages(priceAnalyses[idx]),
        isMissing: parts.length === 0,
      } satisfies ComparisonValueCell;
    }),
    diffStatus: "missing",
  };
  deltaRow.diffStatus = calculateRowDiffStatus(deltaRow.values);
  let includeDeltaRow = false;
  if (deltaRow.values.some((value) => !value.isMissing)) {
    priceRows.push(deltaRow);
    includeDeltaRow = true;
  }

  const coverageSources: ComparisonSectionSource[] = [];
  const coverageRows: ComparisonSectionRow[] = [];

  const ocSource = metadataMap.get("coverage.oc");
  const ocRow: ComparisonSectionRow = {
    id: "coverage.oc",
    label: "Zakres OC",
    type: "metric",
    icon: "coverage",
    analysisLabel: "Analiza AI",
    values: offers.map((offer, idx) => {
      const sumValue = offer.data?.coverage?.oc?.sum ?? null;
      const sourceEntry = matchSourceEntry(ocSource, offer, idx);
      const formatted = formatValueWithUnit(sumValue, {
        type: "number",
        unit: sourceEntry?.unit ?? "PLN",
        source: sourceEntry?.source ?? ocSource?.label ?? null,
        normalization: sourceEntry?.normalization ?? "PLN",
        note: sourceEntry?.note ?? null,
      });
      const highlight = coverageAnalyses[idx]?.highlight as HighlightTone;
      return {
        offerId: offer.id,
        formattedValue: formatted.displayValue,
        normalizedValue: formatted.normalizedValue ?? undefined,
        rawValue: sumValue,
        tooltip: formatted.tooltip,
        highlight,
        aiMessages: getAiMessages(coverageAnalyses[idx]),
        isMissing: formatted.displayValue === null,
      } satisfies ComparisonValueCell;
    }),
    diffStatus: "missing",
  };
  ocRow.diffStatus = calculateRowDiffStatus(ocRow.values);
  coverageRows.push(ocRow);

  const acSource = metadataMap.get("coverage.ac");
  const acRow: ComparisonSectionRow = {
    id: "coverage.ac",
    label: "Zakres AC",
    type: "metric",
    icon: "coverage",
    analysisLabel: "Analiza AI",
    values: offers.map((offer, idx) => {
      const sumValue = offer.data?.coverage?.ac?.sum ?? null;
      const sourceEntry = matchSourceEntry(acSource, offer, idx);
      const formatted = formatValueWithUnit(sumValue, {
        type: "number",
        unit: sourceEntry?.unit ?? "PLN",
        source: sourceEntry?.source ?? acSource?.label ?? null,
        normalization: sourceEntry?.normalization ?? "PLN",
        note: sourceEntry?.note ?? null,
      });
      const highlight = coverageAnalyses[idx]?.highlight as HighlightTone;
      return {
        offerId: offer.id,
        formattedValue: formatted.displayValue,
        normalizedValue: formatted.normalizedValue ?? undefined,
        rawValue: sumValue,
        tooltip: formatted.tooltip,
        highlight,
        aiMessages: getAiMessages(coverageAnalyses[idx]),
        isMissing: formatted.displayValue === null,
      } satisfies ComparisonValueCell;
    }),
    diffStatus: "missing",
  };
  acRow.diffStatus = calculateRowDiffStatus(acRow.values);
  coverageRows.push(acRow);

  const deductibleSource = metadataMap.get("coverage.deductible");
  const deductibleRow: ComparisonSectionRow = {
    id: "coverage.deductible",
    label: "Franszyza",
    type: "metric",
    icon: "percent",
    values: offers.map((offer, idx) => {
      const amount = offer.data?.deductible?.amount ?? null;
      const unit = offer.data?.deductible?.currency ?? currencies[idx];
      const sourceEntry = matchSourceEntry(deductibleSource, offer, idx);
      const formatted = formatValueWithUnit(amount, {
        type: "currency",
        unit: sourceEntry?.unit ?? unit,
        source: sourceEntry?.source ?? deductibleSource?.label ?? null,
        normalization: sourceEntry?.normalization ?? unit,
        note: sourceEntry?.note ?? null,
      });
      return {
        offerId: offer.id,
        formattedValue: formatted.displayValue ?? "Brak",
        normalizedValue: formatted.normalizedValue ?? undefined,
        rawValue: amount,
        tooltip: formatted.tooltip,
        highlight: undefined,
        aiMessages: [],
        isMissing: formatted.displayValue === null,
      } satisfies ComparisonValueCell;
    }),
    diffStatus: "missing",
  };
  deductibleRow.diffStatus = calculateRowDiffStatus(deductibleRow.values);
  coverageRows.push(deductibleRow);

  const assistanceSources: ComparisonSectionSource[] = [];
  const assistanceSource = metadataMap.get("assistance.items");
  const assistanceRows: ComparisonSectionRow[] = [];
  const assistanceRow: ComparisonSectionRow = {
    id: "assistance.items",
    label: "Assistance",
    type: "list",
    icon: "assistance",
    analysisLabel: "Analiza AI",
    aiFallbackMessage: "Brak komentarza AI",
    values: offers.map((offer, idx) => {
      const rawItems = Array.isArray(offer.data?.unified?.assistance)
        ? offer.data?.unified?.assistance
        : Array.isArray(offer.data?.assistance)
          ? offer.data?.assistance
          : [];
      const items = normalizeListItems(rawItems ?? []);
      const signature = buildListSignature(items);
      const sourceEntry = matchSourceEntry(assistanceSource, offer, idx);
      const highlight = assistanceAnalyses[idx]?.highlight as HighlightTone;
      return {
        offerId: offer.id,
        formattedValue: null,
        normalizedValue: undefined,
        rawValue: rawItems,
        tooltip: sourceEntry?.source
          ? formatValueWithUnit(items.length, {
              type: "number",
              unit: undefined,
              source: sourceEntry.source ?? assistanceSource?.label ?? null,
              normalization: sourceEntry?.normalization ?? null,
              note: sourceEntry?.note ?? null,
            }).tooltip
          : null,
        highlight,
        aiMessages: getAiMessages(assistanceAnalyses[idx]),
        items,
        signature,
        isMissing: items.length === 0,
      } satisfies ComparisonValueCell;
    }),
    diffStatus: "missing",
  };
  assistanceRow.diffStatus = calculateRowDiffStatus(assistanceRow.values);
  assistanceRows.push(assistanceRow);

  const exclusionsSources: ComparisonSectionSource[] = [];
  const exclusionsSource = metadataMap.get("exclusions.items");
  const exclusionsRows: ComparisonSectionRow[] = [];
  const exclusionsRow: ComparisonSectionRow = {
    id: "exclusions.items",
    label: "Wyłączenia",
    type: "list",
    icon: "alert",
    analysisLabel: "Analiza AI",
    aiFallbackMessage: "Brak różnic wykrytych przez AI",
    values: offers.map((offer, idx) => {
      const unifiedData = offer.data?.unified as Record<string, unknown> | undefined;
      const rawItems = Array.isArray(unifiedData?.exclusions)
        ? unifiedData.exclusions
        : Array.isArray((offer.data as Record<string, unknown> | null)?.exclusions)
          ? ((offer.data as Record<string, unknown>).exclusions as unknown[])
          : [];
      const items = normalizeListItems(rawItems ?? []);
      const signature = buildListSignature(items);
      const sourceEntry = matchSourceEntry(exclusionsSource, offer, idx);
      const highlight = exclusionsAnalyses[idx]?.highlight as HighlightTone;
      return {
        offerId: offer.id,
        formattedValue: null,
        normalizedValue: undefined,
        rawValue: rawItems,
        tooltip: sourceEntry?.source
          ? formatValueWithUnit(items.length, {
              type: "number",
              unit: undefined,
              source: sourceEntry.source ?? exclusionsSource?.label ?? null,
              normalization: sourceEntry?.normalization ?? null,
              note: sourceEntry?.note ?? null,
            }).tooltip
          : null,
        highlight,
        aiMessages: getAiMessages(exclusionsAnalyses[idx]),
        items,
        signature,
        isMissing: items.length === 0,
      } satisfies ComparisonValueCell;
    }),
    diffStatus: "missing",
  };
  exclusionsRow.diffStatus = calculateRowDiffStatus(exclusionsRow.values);
  exclusionsRows.push(exclusionsRow);

  const registerSectionSources = (
    sectionSources: ComparisonSectionSource[],
    rowId: string,
    rowLabel: string,
    rowSource?: ComparisonSourceMetadataRow,
  ) => {
    const transformed = transformRowSource(rowId, rowLabel, rowSource);
    if (transformed) {
      sectionSources.push(transformed);
    }
  };

  registerSectionSources(priceSources, totalPremiumRow.id, totalPremiumRow.label, totalPremiumSource);
  if (includeDeltaRow) {
    registerSectionSources(priceSources, deltaRow.id, deltaRow.label, deltaSource);
  }
  registerSectionSources(coverageSources, ocRow.id, ocRow.label, ocSource);
  registerSectionSources(coverageSources, acRow.id, acRow.label, acSource);
  registerSectionSources(coverageSources, deductibleRow.id, deductibleRow.label, deductibleSource);
  registerSectionSources(assistanceSources, assistanceRow.id, assistanceRow.label, assistanceSource);
  registerSectionSources(exclusionsSources, exclusionsRow.id, exclusionsRow.label, exclusionsSource);

  const sectionStatus = (rows: ComparisonSectionRow[]): ComparisonDiffStatus =>
    rows.reduce<ComparisonDiffStatus>((status, row) => mergeSectionStatus(status, row.diffStatus), "missing");

  sections.push({
    id: "price",
    title: "Cena i składki",
    icon: "price",
    rows: priceRows,
    diffStatus: sectionStatus(priceRows),
    sources: priceSources,
    defaultExpanded: true,
  });

  sections.push({
    id: "coverage",
    title: "Zakres ochrony",
    icon: "coverage",
    rows: coverageRows,
    diffStatus: sectionStatus(coverageRows),
    sources: coverageSources,
    defaultExpanded: true,
  });

  sections.push({
    id: "assistance",
    title: "Assistance",
    icon: "assistance",
    rows: assistanceRows,
    diffStatus: sectionStatus(assistanceRows),
    sources: assistanceSources,
    defaultExpanded: false,
  });

  sections.push({
    id: "exclusions",
    title: "Wyłączenia",
    icon: "exclusions",
    rows: exclusionsRows,
    diffStatus: sectionStatus(exclusionsRows),
    sources: exclusionsSources,
    defaultExpanded: false,
  });

  return sections;
};
