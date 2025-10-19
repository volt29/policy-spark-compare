import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  DollarSign,
  Heart,
  Percent,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getPremium, type ComparisonOffer } from "@/lib/comparison-utils";
import type {
  ComparisonAnalysis,
  ComparisonAnalysisOffer,
  ComparisonAnalysisSection,
} from "@/types/comparison";

type HighlightTone = "best" | "warning" | "neutral" | undefined;

const HIGHLIGHT_CELL_CLASSES: Record<Exclude<HighlightTone, "neutral" | undefined>, string> = {
  best: "bg-emerald-50 border-l-4 border-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-700",
  warning: "bg-amber-50 border-l-4 border-amber-400 dark:bg-amber-900/30 dark:border-amber-700",
};

const HIGHLIGHT_NOTE_CLASSES: Record<Exclude<HighlightTone, "neutral" | undefined>, string> = {
  best: "bg-emerald-50/70 border border-emerald-200 text-emerald-900 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-100",
  warning: "bg-amber-50/80 border border-amber-200 text-amber-900 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-100",
};

const HIGHLIGHT_BADGE_CLASSES: Record<Exclude<HighlightTone, "neutral" | undefined>, string> = {
  best: "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200",
  warning: "bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200",
};

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

const formatCurrency = (value: number, currency: string) => {
  const safeCurrency = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "PLN";
  try {
    return new Intl.NumberFormat("pl-PL", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString("pl-PL", { maximumFractionDigits: 2 })} ${safeCurrency}`;
  }
};

const getOfferCurrency = (offer: ComparisonOffer): string => {
  const legacyCurrency = offer.data?.premium?.currency;
  if (typeof legacyCurrency === "string" && legacyCurrency.trim().length > 0) {
    return legacyCurrency.trim().toUpperCase();
  }
  return "PLN";
};

const getHighlightCellClass = (highlight: HighlightTone) => {
  if (!highlight || highlight === "neutral") {
    return undefined;
  }
  return HIGHLIGHT_CELL_CLASSES[highlight];
};

const getHighlightNoteClass = (highlight: HighlightTone) => {
  if (!highlight || highlight === "neutral") {
    return "border border-muted";
  }
  return HIGHLIGHT_NOTE_CLASSES[highlight];
};

const getHighlightLabel = (highlight: HighlightTone) => {
  if (highlight === "best") return "Rekomendacja AI";
  if (highlight === "warning") return "Ostrzeżenie";
  return null;
};

const getHighlightBadgeClass = (highlight: HighlightTone) => {
  if (!highlight || highlight === "neutral") {
    return "";
  }
  return HIGHLIGHT_BADGE_CLASSES[highlight];
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

  const candidateKeys = [
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
    for (const key of candidateKeys) {
      const valueCandidate = record[key];
      const numeric = toNumber(valueCandidate);
      if (numeric !== null) {
        delta = numeric;
        break;
      }
    }

    for (const key of percentKeys) {
      const valueCandidate = record[key];
      const numeric = toNumber(valueCandidate);
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

interface ComparisonTableProps {
  offers: ComparisonOffer[];
  bestOfferIndex?: number;
  comparisonAnalysis: ComparisonAnalysis | null;
}

export function ComparisonTable({ offers, bestOfferIndex, comparisonAnalysis }: ComparisonTableProps) {
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const toggleRow = (rowId: string) => {
    setExpandedRows((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
  };

  const priceLookup = useMemo(
    () => createAnalysisLookup(comparisonAnalysis?.price_comparison),
    [comparisonAnalysis],
  );
  const coverageLookup = useMemo(
    () => createAnalysisLookup(comparisonAnalysis?.coverage_comparison),
    [comparisonAnalysis],
  );
  const assistanceLookup = useMemo(
    () => createAnalysisLookup(comparisonAnalysis?.assistance_comparison),
    [comparisonAnalysis],
  );
  const exclusionsLookup = useMemo(
    () => createAnalysisLookup(comparisonAnalysis?.exclusions_diff),
    [comparisonAnalysis],
  );

  const priceAnalyses = useMemo(
    () => offers.map((offer, idx) => getOfferAnalysis(priceLookup, offer, idx)),
    [offers, priceLookup],
  );
  const coverageAnalyses = useMemo(
    () => offers.map((offer, idx) => getOfferAnalysis(coverageLookup, offer, idx)),
    [offers, coverageLookup],
  );
  const assistanceAnalyses = useMemo(
    () => offers.map((offer, idx) => getOfferAnalysis(assistanceLookup, offer, idx)),
    [offers, assistanceLookup],
  );
  const exclusionsAnalyses = useMemo(
    () => offers.map((offer, idx) => getOfferAnalysis(exclusionsLookup, offer, idx)),
    [offers, exclusionsLookup],
  );

  const premiums = useMemo(
    () => offers.map((offer) => getPremium(offer.data)),
    [offers],
  );
  const currencies = useMemo(
    () => offers.map((offer) => getOfferCurrency(offer)),
    [offers],
  );
  const availablePremiums = premiums.filter((value): value is number => value !== null);
  const lowestPremium = availablePremiums.length > 0 ? Math.min(...availablePremiums) : null;

  const ocCoverages = useMemo(
    () => offers.map((offer) => toNumber(offer.data?.coverage?.oc?.sum)),
    [offers],
  );
  const acCoverages = useMemo(
    () => offers.map((offer) => toNumber(offer.data?.coverage?.ac?.sum)),
    [offers],
  );

  const renderAiBlock = (
    analysis: ComparisonAnalysisOffer | undefined,
    heading: string,
    highlight: HighlightTone,
    emptyMessage = "Brak analizy AI",
  ) => {
    const messages = getAiMessages(analysis);
    const shouldRender = messages.length > 0 || (highlight && highlight !== "neutral");
    if (!shouldRender) {
      return null;
    }

    return (
      <div className={cn("rounded-md p-3 text-xs leading-snug space-y-1", getHighlightNoteClass(highlight))}>
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {heading}
          {getHighlightLabel(highlight) && (
            <Badge variant="outline" className={cn("text-[10px]", getHighlightBadgeClass(highlight))}>
              {getHighlightLabel(highlight)}
            </Badge>
          )}
        </div>
        <div className="mt-1 space-y-1 text-sm">
          {messages.length > 0 ? (
            messages.map((message, idx) => <p key={idx}>{message}</p>)
          ) : (
            <p className="text-muted-foreground text-xs">{emptyMessage}</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <Card className="shadow-elevated">
      <CardHeader>
        <CardTitle>Szczegółowe porównanie</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Kategoria</TableHead>
                {offers.map((offer, idx) => (
                  <TableHead
                    key={offer.id}
                    className={cn(idx === bestOfferIndex && "bg-primary/5")}
                  >
                    <div className="space-y-1">
                      <div className="font-semibold">{offer.insurer}</div>
                      {idx === bestOfferIndex && (
                        <Badge variant="default" className="text-xs">
                          Rekomendowana
                        </Badge>
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/30">
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-primary" />
                    Składka miesięczna
                  </div>
                </TableCell>
                {offers.map((offer, idx) => {
                  const premium = premiums[idx];
                  const highlight = priceAnalyses[idx]?.highlight as HighlightTone;
                  const highlightClass = getHighlightCellClass(highlight);
                  return (
                    <TableCell
                      key={offer.id}
                      className={cn(
                        idx === bestOfferIndex && !highlightClass && "bg-primary/5",
                        highlightClass,
                      )}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          {lowestPremium !== null && premium !== null && premium === lowestPremium && (
                            <ArrowDown className="w-4 h-4 text-success" />
                          )}
                          <span>
                            {premium !== null
                              ? formatCurrency(premium, currencies[idx])
                              : "Brak danych"}
                          </span>
                        </div>
                        {renderAiBlock(priceAnalyses[idx], "Analiza AI", highlight, "Brak komentarza AI")}
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>

              {priceAnalyses.some((analysis) => {
                const metrics = getPriceMetrics(analysis);
                return metrics.delta !== null || metrics.percent !== null;
              }) && (
                <TableRow>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <ArrowUp className="w-4 h-4 text-primary" />
                      Odchylenie od średniej
                    </div>
                  </TableCell>
                  {offers.map((offer, idx) => {
                    const highlight = priceAnalyses[idx]?.highlight as HighlightTone;
                    const highlightClass = getHighlightCellClass(highlight);
                    const metrics = getPriceMetrics(priceAnalyses[idx]);
                    return (
                      <TableCell
                        key={`${offer.id}-delta`}
                        className={cn(
                          idx === bestOfferIndex && !highlightClass && "bg-primary/5",
                          highlightClass,
                        )}
                      >
                        <div className="space-y-2">
                          <div className="flex flex-col gap-1">
                            {metrics.delta !== null && (
                              <span className="font-medium">
                                {formatCurrency(metrics.delta, currencies[idx])}
                              </span>
                            )}
                            {metrics.percent !== null && (
                              <span className="text-xs text-muted-foreground">
                                {formatPercent(metrics.percent)}
                              </span>
                            )}
                          </div>
                          {renderAiBlock(priceAnalyses[idx], "Komentarz AI", highlight, "Brak komentarza AI")}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              )}

              <TableRow>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    Zakres OC
                  </div>
                </TableCell>
                {offers.map((offer, idx) => {
                  const ocSum = ocCoverages[idx];
                  const highlight = coverageAnalyses[idx]?.highlight as HighlightTone;
                  const highlightClass = getHighlightCellClass(highlight);
                  return (
                    <TableCell
                      key={`${offer.id}-oc`}
                      className={cn(
                        idx === bestOfferIndex && !highlightClass && "bg-primary/5",
                        highlightClass,
                      )}
                    >
                      <div className="space-y-2">
                        <span>
                          {ocSum !== null
                            ? `${ocSum.toLocaleString("pl-PL")} PLN`
                            : "Brak danych"}
                        </span>
                        {renderAiBlock(coverageAnalyses[idx], "Analiza AI", highlight)}
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>

              <TableRow>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    Zakres AC
                  </div>
                </TableCell>
                {offers.map((offer, idx) => {
                  const acSum = acCoverages[idx];
                  const highlight = coverageAnalyses[idx]?.highlight as HighlightTone;
                  const highlightClass = getHighlightCellClass(highlight);
                  return (
                    <TableCell
                      key={`${offer.id}-ac`}
                      className={cn(
                        idx === bestOfferIndex && !highlightClass && "bg-primary/5",
                        highlightClass,
                      )}
                    >
                      <div className="space-y-2">
                        <span>
                          {acSum !== null
                            ? `${acSum.toLocaleString("pl-PL")} PLN`
                            : "Brak danych"}
                        </span>
                        {renderAiBlock(coverageAnalyses[idx], "Analiza AI", highlight)}
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>

              <TableRow>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Percent className="w-4 h-4 text-primary" />
                    Franszyza
                  </div>
                </TableCell>
                {offers.map((offer, idx) => {
                  const deductible = toNumber(offer.data?.deductible?.amount);
                  return (
                    <TableCell
                      key={`${offer.id}-deductible`}
                      className={cn(idx === bestOfferIndex && "bg-primary/5")}
                    >
                      {deductible !== null
                        ? `${deductible} ${offer.data?.deductible?.currency || "PLN"}`
                        : "Brak"}
                    </TableCell>
                  );
                })}
              </TableRow>

              <TableRow>
                <TableCell colSpan={offers.length + 1} className="p-0">
                  <Collapsible
                    open={expandedRows["assistance"]}
                    onOpenChange={() => toggleRow("assistance")}
                  >
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center gap-2 p-3 transition-colors hover:bg-muted/50">
                        <Heart className="w-4 h-4 text-primary" />
                        <span className="font-medium">Assistance</span>
                        <ChevronDown
                          className={cn(
                            "w-4 h-4 ml-auto transition-transform",
                            expandedRows["assistance"] && "rotate-180",
                          )}
                        />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div
                        className="grid"
                        style={{ gridTemplateColumns: `200px repeat(${offers.length}, 1fr)` }}
                      >
                        <div className="p-3"></div>
                        {offers.map((offer, idx) => {
                          const assistanceItems = Array.isArray(offer.data?.unified?.assistance)
                            ? offer.data.unified.assistance
                            : Array.isArray(offer.data?.assistance)
                              ? offer.data.assistance
                              : [];
                          const analysis = assistanceAnalyses[idx];
                          const highlight = analysis?.highlight as HighlightTone;

                          return (
                            <div
                              key={offer.id}
                              className={cn(
                                "p-3 border-t",
                                idx === bestOfferIndex && !(highlight && highlight !== "neutral") && "bg-primary/5",
                              )}
                            >
                              <div className="space-y-3">
                                <div>
                                  <div className="text-xs font-medium uppercase text-muted-foreground">
                                    Dane z dokumentu
                                  </div>
                                  {assistanceItems.length > 0 ? (
                                    <ul className="mt-2 space-y-1 text-sm">
                                      {assistanceItems.map((service: any, i: number) => (
                                        <li key={i} className="flex items-start gap-1">
                                          <span className="text-primary mt-0.5">•</span>
                                          <span>{typeof service === "string" ? service : service?.name}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <span className="text-muted-foreground text-sm">Brak danych</span>
                                  )}
                                </div>
                                {renderAiBlock(analysis, "Analiza AI", highlight)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </TableCell>
              </TableRow>

              <TableRow>
                <TableCell colSpan={offers.length + 1} className="p-0">
                  <Collapsible
                    open={expandedRows["exclusions"]}
                    onOpenChange={() => toggleRow("exclusions")}
                  >
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center gap-2 p-3 transition-colors hover:bg-muted/50">
                        <AlertCircle className="w-4 h-4 text-primary" />
                        <span className="font-medium">Wyłączenia</span>
                        <ChevronDown
                          className={cn(
                            "w-4 h-4 ml-auto transition-transform",
                            expandedRows["exclusions"] && "rotate-180",
                          )}
                        />
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div
                        className="grid"
                        style={{ gridTemplateColumns: `200px repeat(${offers.length}, 1fr)` }}
                      >
                        <div className="p-3"></div>
                        {offers.map((offer, idx) => {
                          const exclusionsItems = Array.isArray(offer.data?.unified?.exclusions)
                            ? offer.data.unified.exclusions
                            : Array.isArray(offer.data?.exclusions)
                              ? offer.data.exclusions
                              : [];
                          const analysis = exclusionsAnalyses[idx];
                          const highlight = analysis?.highlight as HighlightTone;

                          return (
                            <div
                              key={offer.id}
                              className={cn(
                                "p-3 border-t",
                                idx === bestOfferIndex && !(highlight && highlight !== "neutral") && "bg-primary/5",
                              )}
                            >
                              <div className="space-y-3">
                                <div>
                                  <div className="text-xs font-medium uppercase text-muted-foreground">
                                    Dane z dokumentu
                                  </div>
                                  {exclusionsItems.length > 0 ? (
                                    <ul className="mt-2 space-y-1 text-sm">
                                      {exclusionsItems.map((exclusion: any, i: number) => (
                                        <li key={i} className="flex items-start gap-1">
                                          <span className="text-destructive mt-0.5">•</span>
                                          <span>
                                            {typeof exclusion === "string"
                                              ? exclusion
                                              : exclusion?.name || exclusion?.coverage || "Brak opisu"}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <span className="text-muted-foreground text-sm">Brak informacji</span>
                                  )}
                                </div>
                                {renderAiBlock(
                                  analysis,
                                  "Analiza AI",
                                  highlight,
                                  "Brak różnic wykrytych przez AI",
                                ) || (
                                  <div className="rounded-md border border-muted p-3 text-xs text-muted-foreground">
                                    Brak analizy AI
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
