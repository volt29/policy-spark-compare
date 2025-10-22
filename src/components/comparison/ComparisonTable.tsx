import { Fragment, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertCircle,
  ChevronDown,
  DollarSign,
  Heart,
  Info,
  Percent,
  Shield,
  Building2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ComparisonOffer } from "@/lib/comparison-utils";
import { getPremium } from "@/lib/comparison-utils";
import {
  type ComparisonDiffStatus,
  type ComparisonSection,
  type ComparisonSectionRow,
  type ComparisonValueCell,
  type HighlightTone,
} from "@/lib/buildComparisonSections";
import { usePersistentSectionState } from "@/hooks/usePersistentSectionState";
import { ArrowDown } from "lucide-react";
import { formatCurrency } from "@/lib/valueFormatters";
import { SourceTooltip } from "@/components/comparison/SourceTooltip";
import { segmentTextWithLinks } from "@/lib/safeLinks";

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

const SECTION_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  price: DollarSign,
  coverage: Shield,
  assistance: Heart,
  exclusions: AlertCircle,
};

const ROW_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  price: DollarSign,
  delta: Sparkles,
  coverage: Shield,
  percent: Percent,
  assistance: Heart,
  alert: AlertCircle,
};

const DIFF_BADGE_LABEL: Record<ComparisonDiffStatus, string> = {
  equal: "Brak różnic",
  different: "Różnice",
  partial: "Niepełne dane",
  missing: "Brak danych",
};

const DIFF_BADGE_CLASS: Record<ComparisonDiffStatus, string> = {
  equal: "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-200",
  different: "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-600 dark:bg-amber-500/10 dark:text-amber-200",
  partial: "border-sky-200 bg-sky-500/10 text-sky-700 dark:border-sky-600 dark:bg-sky-500/10 dark:text-sky-200",
  missing: "border-muted bg-muted text-muted-foreground",
};

const getHighlightCellClass = (highlight: HighlightTone) => {
  if (!highlight || highlight === "neutral") {
    return undefined;
  }
  return HIGHLIGHT_CELL_CLASSES[highlight];
};

const getHighlightLabel = (highlight: HighlightTone) => {
  if (highlight === "best") return "Rekomendacja AI";
  if (highlight === "warning") return "Ostrzeżenie";
  return null;
};

const getHighlightNoteClass = (highlight: HighlightTone) => {
  if (!highlight || highlight === "neutral") {
    return "border border-muted bg-muted/40";
  }
  return HIGHLIGHT_NOTE_CLASSES[highlight];
};

const getHighlightBadgeClass = (highlight: HighlightTone) => {
  if (!highlight || highlight === "neutral") {
    return "";
  }
  return HIGHLIGHT_BADGE_CLASSES[highlight];
};

const getRowDiffIndicatorClass = (status: ComparisonDiffStatus) => {
  if (status === "different") {
    return "relative pl-5 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1 before:rounded-full before:bg-amber-500";
  }
  if (status === "partial") {
    return "relative pl-5 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1 before:rounded-full before:bg-muted";
  }
  return "pl-5";
};

const getValueCellDiffClass = (status: ComparisonDiffStatus) => {
  if (status === "different") {
    return "relative pl-4 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1 before:rounded-full before:bg-amber-400";
  }
  if (status === "partial") {
    return "relative pl-4 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1 before:rounded-full before:bg-muted";
  }
  return "pl-4";
};

interface ComparisonTableProps {
  comparisonId: string;
  offers: ComparisonOffer[];
  sections: ComparisonSection[];
  bestOfferIndex?: number;
}

export function ComparisonTable({
  comparisonId,
  offers,
  sections,
  bestOfferIndex,
}: ComparisonTableProps) {
  const defaults = useMemo(
    () => Object.fromEntries(sections.map((section) => [section.id, section.defaultExpanded ?? true])),
    [sections],
  );

  const { isSectionOpen, toggleSection } = usePersistentSectionState(
    comparisonId,
    sections.map((section) => section.id),
    { defaults },
  );

  // Calculate premiums and related data
  const premiums = useMemo(() => offers.map((offer) => getPremium(offer.data)), [offers]);
  
  const lowestPremium = useMemo(() => {
    return premiums.reduce<number | null>((acc, premium) => {
      if (premium !== null && (acc === null || premium < acc)) {
        return premium;
      }
      return acc;
    }, null);
  }, [premiums]);

  const currencies = useMemo(() => {
    return offers.map((offer) => {
      const currency = offer.data?.premium?.currency;
      return currency && typeof currency === 'string' ? currency : 'PLN';
    });
  }, [offers]);

  // Find price section and analyses
  const priceSection = useMemo(() => sections.find((s) => s.id === 'price'), [sections]);
  const priceRow = useMemo(() => priceSection?.rows.find((r) => r.id === 'price.total'), [priceSection]);
  const priceAnalyses = useMemo(() => priceRow?.values ?? [], [priceRow]);

  const renderSegments = (text: string, keyPrefix: string) =>
    segmentTextWithLinks(text).map((segment, idx) => {
      const key = `${keyPrefix}-${idx}`;
      if (segment.type === "link") {
        if (segment.safe) {
          return (
            <a
              key={key}
              href={segment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-4"
            >
              {segment.value}
            </a>
          );
        }
        return (
          <span key={key} className="text-destructive" title={segment.reason ?? "Link oznaczony jako niebezpieczny"}>
            {segment.value}
          </span>
        );
      }
      return (
        <Fragment key={key}>{segment.value}</Fragment>
      );
    });

  const renderLine = (line: string, lineIndex: number) => (
    <span key={`line-${lineIndex}`} className="block font-medium">
      {renderSegments(line, `segment-${lineIndex}`)}
    </span>
  );

  const renderValueContent = (
    cell: ComparisonValueCell,
    row: ComparisonSectionRow,
  ) => {
    const hasTooltip = Boolean(cell.tooltip);
    const valueContent = (() => {
      if (row.type === "list") {
        if (!cell.items || cell.items.length === 0) {
          return null;
        }
        return (
          <ul className="space-y-1 text-sm leading-relaxed">
            {cell.items.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/60" />
                <span>{renderSegments(item, `list-${row.id}-${idx}`)}</span>
              </li>
            ))}
          </ul>
        );
      }

      if (cell.formattedValue) {
        const lines = cell.formattedValue.split("\n");
        const renderedLines = lines.map((part, idx) => renderLine(part, idx));
        return <div className="space-y-1 text-sm leading-relaxed">{renderedLines}</div>;
      }

      return null;
    })();

    if (!valueContent) {
      return <span className="text-sm text-muted-foreground">—</span>;
    }

    const contentWithTooltip = hasTooltip ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-1">{valueContent}</div>
            <Info className="mt-0.5 h-4 w-4 text-muted-foreground" />
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-sm leading-relaxed">
          {cell.tooltip}
        </TooltipContent>
      </Tooltip>
    ) : (
      valueContent
    );

    if (cell.sourceReferences && cell.sourceReferences.length > 0) {
      return (
        <SourceTooltip reference={cell.sourceReferences}>
          {contentWithTooltip}
        </SourceTooltip>
      );
    }

    return contentWithTooltip;
  };

  const renderAiBlock = (cell: ComparisonValueCell, row: ComparisonSectionRow) => {
    const shouldRender =
      (cell.aiMessages.length > 0 || (cell.highlight && cell.highlight !== "neutral")) &&
      row.analysisLabel !== undefined;
    if (!shouldRender) {
      return null;
    }

    const highlightLabel = getHighlightLabel(cell.highlight);

    return (
      <div
        className={cn(
          "mt-3 space-y-1 rounded-md p-3 text-xs leading-snug",
          getHighlightNoteClass(cell.highlight),
        )}
      >
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {row.analysisLabel ?? "Analiza AI"}
          {highlightLabel && (
            <Badge variant="outline" className={cn("text-[10px]", getHighlightBadgeClass(cell.highlight))}>
              {highlightLabel}
            </Badge>
          )}
        </div>
        <div className="space-y-1 text-xs text-foreground">
          {cell.aiMessages.length > 0 ? (
            cell.aiMessages.map((message, idx) => <p key={idx}>{message}</p>)
          ) : (
            <p className="text-muted-foreground">{row.aiFallbackMessage ?? "Brak analizy AI"}</p>
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
        <TooltipProvider>
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
                      <div className="font-semibold text-foreground">{offer.label}</div>
                      {offer.insurer && (
                        <Badge variant="outline" className="flex items-center gap-1 text-[11px]">
                          <Building2 className="h-3 w-3" />
                          {offer.insurer}
                        </Badge>
                      )}
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
                            <ArrowDown className="w-4 h-4 text-emerald-600" />
                          )}
                          <span>
                            {premium !== null
                              ? formatCurrency(premium, currencies[idx])
                              : "Brak danych"}
                          </span>
                        </div>
                        {priceAnalyses[idx] && renderAiBlock(priceAnalyses[idx], { 
                          type: 'metric',
                          id: 'price.total',
                          label: 'Składka miesięczna',
                          icon: 'price',
                          analysisLabel: 'Analiza AI',
                          aiFallbackMessage: 'Brak komentarza AI',
                          values: [],
                          diffStatus: 'equal'
                        } as ComparisonSectionRow)}
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>

            </TableBody>
          </Table>
          </div>

          <div className="rounded-lg border bg-card">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[240px]">Sekcja</TableHead>
                {offers.map((offer, idx) => (
                  <TableHead key={offer.id} className={cn(idx === bestOfferIndex && "bg-primary/5")}>
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
                {sections.map((section) => {
                  const Icon = section.icon ? SECTION_ICON_MAP[section.icon] ?? Shield : Shield;
                  const open = isSectionOpen(section.id, section.defaultExpanded ?? true);

                  return (
                    <Fragment key={section.id}>
                      <TableRow className="bg-muted/40">
                        <TableCell colSpan={offers.length + 1} className="p-0">
                          <button
                            type="button"
                            onClick={() => toggleSection(section.id)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
                          >
                            <Icon className="h-4 w-4 text-primary" />
                            <div className="flex-1">
                              <div className="font-semibold">{section.title}</div>
                              {section.sources.length > 0 && (
                                <div className="text-xs text-muted-foreground">
                                  {section.sources.map((source) => source.label).join(" • ")}
                                </div>
                              )}
                            </div>
                            <Badge
                              variant="outline"
                              className={cn("text-[10px] uppercase", DIFF_BADGE_CLASS[section.diffStatus])}
                            >
                              {DIFF_BADGE_LABEL[section.diffStatus]}
                            </Badge>
                            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
                            />
                          </button>
                        </TableCell>
                      </TableRow>
                      {open &&
                        section.rows.map((row) => {
                          const RowIcon = row.icon ? ROW_ICON_MAP[row.icon] ?? Shield : Shield;
                          return (
                            <TableRow key={row.id}>
                              <TableCell className={cn("align-top text-sm font-medium", getRowDiffIndicatorClass(row.diffStatus))}>
                                <div className="flex items-start gap-2">
                                  <RowIcon className="mt-1 h-4 w-4 text-primary" />
                                  <span>{row.label}</span>
                                </div>
                              </TableCell>
                              {row.values.map((cell, idx) => {
                                const highlightClass = getHighlightCellClass(cell.highlight);
                                const diffClass = highlightClass
                                  ? "pl-4"
                                  : getValueCellDiffClass(row.diffStatus);
                                return (
                                  <TableCell
                                    key={`${row.id}-${offers[idx]?.id ?? idx}`}
                                    className={cn(
                                      "align-top text-sm",
                                      diffClass,
                                      highlightClass,
                                      idx === bestOfferIndex && !highlightClass && "bg-primary/5",
                                    )}
                                  >
                                    <div className="space-y-3">
                                      {renderValueContent(cell, row)}
                                      {renderAiBlock(cell, row)}
                                    </div>
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          );
                        })}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
