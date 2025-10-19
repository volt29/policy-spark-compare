import { Fragment, ReactNode, useCallback, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles, CheckCircle2, AlertTriangle, ArrowRight, Copy } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { ComparisonSummary, ComparisonSummaryKeyNumber } from "@/types/comparison";

const SOURCE_REGEX = /\{\{\s*source:([^}\s]+)\s*\}\}/gi;
const EMPTY_KEY_NUMBERS: ComparisonSummaryKeyNumber[] = [];

export interface LabeledOffer {
  id: string;
  label: string;
  insurer?: string | null;
}

interface AiSummaryPanelProps {
  summaryData: ComparisonSummary | null;
  fallbackSummaryText?: string | null;
  offers: LabeledOffer[];
  sourcesMap?: Record<string, unknown> | null;
  className?: string;
}

interface NormalizedSource {
  key: string;
  order: number;
  shortLabel: string;
  label?: string;
  offerLabel?: string;
  excerpt?: string;
  description?: string;
  page?: string;
}

interface SourceTooltipProps {
  source: NormalizedSource;
}

function SourceTooltip({ source }: SourceTooltipProps) {
  const heading = source.label ?? source.offerLabel ?? `Źródło ${source.order}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="button"
          aria-label={`Pokaż źródło ${source.shortLabel}`}
          className="ml-1 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 transition focus:outline-none focus:ring-2 focus:ring-amber-400/70 dark:bg-amber-400/20 dark:text-amber-100"
        >
          [{source.shortLabel}]
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1 text-left">
        <p className="text-xs font-semibold leading-none text-foreground">{heading}</p>
        {source.offerLabel && (
          <p className="text-xs text-muted-foreground">Oferta: {source.offerLabel}</p>
        )}
        {source.page && (
          <p className="text-xs text-muted-foreground">Strona: {source.page}</p>
        )}
        {(source.excerpt || source.description) && (
          <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
            {source.excerpt ?? source.description}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">Id: {source.key}</p>
      </TooltipContent>
    </Tooltip>
  );
}

const getString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
};

function normalizeSource(
  key: string,
  raw: unknown,
  offerLabelLookup: Map<string, string>,
  order: number,
): NormalizedSource | null {
  if (!raw) {
    return null;
  }

  const normalized: NormalizedSource = {
    key,
    order,
    shortLabel: String(order),
  };

  if (typeof raw === "string") {
    const excerpt = raw.trim();
    if (excerpt) {
      normalized.excerpt = excerpt;
    }
    return normalized;
  }

  if (typeof raw === "number") {
    normalized.excerpt = String(raw);
    return normalized;
  }

  if (Array.isArray(raw)) {
    const joined = raw
      .map((item) => getString(item) ?? "")
      .filter((entry) => entry.length > 0)
      .join(", ");
    if (joined) {
      normalized.excerpt = joined;
    }
    return normalized;
  }

  if (typeof raw !== "object") {
    return normalized;
  }

  const record = raw as Record<string, unknown>;

  const label =
    getString(record.label) ||
    getString(record.title) ||
    getString(record.name) ||
    getString(record.filename) ||
    getString(record.document) ||
    undefined;

  if (label) {
    normalized.label = label;
  }

  const offerId =
    getString(record.offerId) ||
    getString(record.offer_id) ||
    getString(record.offer) ||
    getString(record.offer_ref) ||
    undefined;

  if (offerId) {
    normalized.offerLabel = offerLabelLookup.get(offerId) ?? offerId;
  }

  const excerpt =
    getString(record.excerpt) ||
    getString(record.text) ||
    getString(record.quote) ||
    getString(record.content) ||
    undefined;
  if (excerpt) {
    normalized.excerpt = excerpt;
  }

  const description = getString(record.description) || getString(record.summary) || getString(record.note);
  if (description) {
    normalized.description = description;
  }

  const pageValue = record.page ?? record.page_number ?? record.pageNumber;
  if (typeof pageValue === "number" || typeof pageValue === "string") {
    const pageString = String(pageValue).trim();
    if (pageString) {
      normalized.page = pageString;
    }
  }

  return normalized;
}

function getSummaryText(summary: ComparisonSummary | null): string | null {
  if (!summary) {
    return null;
  }

  return summary.fallback_text ?? summary.raw_text ?? null;
}

export function AiSummaryPanel({
  summaryData,
  fallbackSummaryText,
  offers,
  sourcesMap,
  className,
}: AiSummaryPanelProps) {
  const [showJustifications, setShowJustifications] = useState(false);

  const recommendedOffer = summaryData?.recommended_offer ?? null;
  const reasons = summaryData?.reasons ?? null;
  const risks = summaryData?.risks ?? null;
  const nextSteps = summaryData?.next_steps ?? null;
  const keyNumbers = recommendedOffer?.key_numbers ?? EMPTY_KEY_NUMBERS;

  const hasStructuredSummary = Boolean(
    (recommendedOffer &&
      (recommendedOffer.name || recommendedOffer.insurer || recommendedOffer.summary || keyNumbers.length > 0)) ||
      (reasons && reasons.length > 0) ||
      (risks && risks.length > 0) ||
      (nextSteps && nextSteps.length > 0),
  );

  const fallbackText = fallbackSummaryText ?? getSummaryText(summaryData);

  const offerLabelLookup = useMemo(() => {
    return new Map(offers.map((offer) => [offer.id, offer.label]));
  }, [offers]);

  const resolvedSources = useMemo(() => {
    const map = new Map<string, NormalizedSource>();
    if (!sourcesMap) {
      return map;
    }

    const entries = Object.entries(sourcesMap);
    entries.forEach(([key, raw], index) => {
      const normalized = normalizeSource(key, raw, offerLabelLookup, index + 1);
      if (normalized) {
        map.set(key, normalized);
      }
    });

    return map;
  }, [sourcesMap, offerLabelLookup]);

  const stripSourceMarkers = useCallback(
    (text: string): string =>
      text.replace(SOURCE_REGEX, (_, rawKey: string) => {
        const key = rawKey.trim();
        const source = resolvedSources.get(key);
        if (!source) {
          return "";
        }
        const label = source.label ?? source.offerLabel ?? `Źródło ${source.order}`;
        return ` [${label}]`;
      }),
    [resolvedSources],
  );

  const renderHighlightedText = (text: string, keyPrefix: string) => {
    if (!text) {
      return null;
    }

    if (!showJustifications) {
      return <span className="whitespace-pre-line">{stripSourceMarkers(text)}</span>;
    }

    const content: ReactNode[] = [];
    let lastIndex = 0;
    let matchCount = 0;

    text.replace(SOURCE_REGEX, (match: string, rawKey: string, offset: number) => {
      if (offset > lastIndex) {
        content.push(text.slice(lastIndex, offset));
      }

      const key = rawKey.trim();
      matchCount += 1;
      const source = resolvedSources.get(key);

      if (source) {
        content.push(<SourceTooltip key={`${keyPrefix}-${key}-${matchCount}`} source={source} />);
      } else {
        content.push(`[${key}]`);
      }

      lastIndex = offset + match.length;
      return match;
    });

    if (lastIndex < text.length) {
      content.push(text.slice(lastIndex));
    }

    return (
      <span className="whitespace-pre-line">
        {content.map((node, index) => (
          <Fragment key={`${keyPrefix}-fragment-${index}`}>{node}</Fragment>
        ))}
      </span>
    );
  };

  const handleCopy = useCallback(async () => {
    const sections: string[] = [];

    if (recommendedOffer) {
      const offerTitle = recommendedOffer.name ?? recommendedOffer.insurer;
      if (offerTitle) {
        sections.push(`Rekomendowana oferta: ${offerTitle}`);
      }
      if (recommendedOffer.summary) {
        sections.push(`Opis: ${stripSourceMarkers(recommendedOffer.summary)}`);
      }
      if (keyNumbers.length > 0) {
        const metrics = keyNumbers.map((metric) => `- ${metric.label}: ${metric.value}`).join("\n");
        sections.push(`Kluczowe liczby:\n${metrics}`);
      }
    }

    if (reasons && reasons.length > 0) {
      const list = reasons.map((reason) => `- ${stripSourceMarkers(reason)}`).join("\n");
      sections.push(`Powody:\n${list}`);
    }

    if (risks && risks.length > 0) {
      const list = risks.map((risk) => `- ${stripSourceMarkers(risk)}`).join("\n");
      sections.push(`Ryzyka:\n${list}`);
    }

    if (nextSteps && nextSteps.length > 0) {
      const list = nextSteps.map((step) => `- ${stripSourceMarkers(step)}`).join("\n");
      sections.push(`Rekomendacje:\n${list}`);
    }

    if (fallbackText && !hasStructuredSummary) {
      sections.push(stripSourceMarkers(fallbackText));
    }

    if (sections.length === 0) {
      toast.info("Brak treści do skopiowania");
      return;
    }

    const payload = sections.join("\n\n");

    if (typeof navigator === "undefined" || !navigator.clipboard) {
      toast.error("Kopiowanie nie jest wspierane w tej przeglądarce");
      return;
    }

    try {
      await navigator.clipboard.writeText(payload);
      toast.success("Skopiowano rekomendację AI");
    } catch (error) {
      toast.error("Nie udało się skopiować treści", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, [
    recommendedOffer,
    keyNumbers,
    reasons,
    risks,
    nextSteps,
    fallbackText,
    hasStructuredSummary,
    stripSourceMarkers,
  ]);

  if (!hasStructuredSummary && !fallbackText) {
    return null;
  }

  return (
    <Card className={cn("shadow-elevated", className)}>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            Rekomendacja AI
          </CardTitle>
          <CardDescription>
            Najważniejsze wskazówki przygotowane na podstawie analizy ofert
          </CardDescription>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Switch
              id="toggle-justifications"
              checked={showJustifications}
              onCheckedChange={(value) => setShowJustifications(Boolean(value))}
            />
            <Label htmlFor="toggle-justifications" className="text-sm text-muted-foreground">
              Pokaż uzasadnienia
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
            <Copy className="h-4 w-4" />
            Kopiuj
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-8">
        {hasStructuredSummary && (
          <div className="space-y-8">
            {recommendedOffer && (
              <section className="space-y-4">
                <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Rekomendowana oferta
                </h3>
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 shadow-sm">
                  {(recommendedOffer.name || recommendedOffer.insurer) && (
                    <div className="space-y-1">
                      {recommendedOffer.name && (
                        <p className="text-xl font-semibold text-primary leading-tight">
                          {recommendedOffer.name}
                        </p>
                      )}
                      {recommendedOffer.insurer && (!recommendedOffer.name || recommendedOffer.insurer !== recommendedOffer.name) && (
                        <p className="text-sm text-muted-foreground">
                          Towarzystwo: {recommendedOffer.insurer}
                        </p>
                      )}
                    </div>
                  )}

                  {recommendedOffer.summary && (
                    <p className="mt-3 text-sm leading-relaxed text-foreground/80">
                      {renderHighlightedText(recommendedOffer.summary, "recommended-summary")}
                    </p>
                  )}

                  {keyNumbers.length > 0 && (
                    <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                      {keyNumbers.map((metric, index) => (
                        <div key={`${metric.label}-${index}`} className="rounded-lg bg-background/80 px-3 py-2 shadow-sm">
                          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {metric.label}
                          </dt>
                          <dd className="text-lg font-semibold text-foreground">{metric.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </section>
            )}

            {reasons && reasons.length > 0 && (
              <section className="space-y-3">
                <h3 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">
                  Powody wyboru
                </h3>
                <ul className="space-y-2">
                  {reasons.map((reason, index) => (
                    <li
                      key={`reason-${index}`}
                      className="flex items-start gap-2 rounded-lg bg-muted/40 p-3"
                    >
                      <CheckCircle2 className="mt-1 h-4 w-4 text-emerald-500" />
                      <span className="text-sm leading-relaxed text-foreground">
                        {renderHighlightedText(reason, `reason-${index}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {risks && risks.length > 0 && (
              <section className="space-y-3">
                <h3 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">
                  Ryzyka
                </h3>
                <ul className="space-y-2">
                  {risks.map((risk, index) => (
                    <li
                      key={`risk-${index}`}
                      className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3"
                    >
                      <AlertTriangle className="mt-1 h-4 w-4 text-destructive" />
                      <span className="text-sm leading-relaxed text-foreground">
                        {renderHighlightedText(risk, `risk-${index}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {nextSteps && nextSteps.length > 0 && (
              <section className="space-y-3">
                <h3 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">
                  Rekomendacje
                </h3>
                <ul className="space-y-2">
                  {nextSteps.map((step, index) => (
                    <li
                      key={`step-${index}`}
                      className="flex items-start gap-2 rounded-lg bg-primary/5 p-3"
                    >
                      <ArrowRight className="mt-1 h-4 w-4 text-primary" />
                      <span className="text-sm leading-relaxed text-foreground">
                        {renderHighlightedText(step, `step-${index}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {fallbackText && hasStructuredSummary && (
          <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            {renderHighlightedText(fallbackText, "fallback")}
          </div>
        )}

        {fallbackText && !hasStructuredSummary && (
          <p className="text-sm leading-relaxed text-foreground">
            {renderHighlightedText(fallbackText, "fallback-only")}
          </p>
        )}

        {showJustifications && resolvedSources.size > 0 && (
          <div className="rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Źródła analizy
            </h4>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {Array.from(resolvedSources.values()).map((source) => (
                <li key={`source-summary-${source.key}`} className="leading-relaxed">
                  <span className="font-medium text-foreground">[{source.shortLabel}]</span>{" "}
                  {source.label ?? source.offerLabel ?? `Źródło ${source.order}`}
                  {source.page && ` — str. ${source.page}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

