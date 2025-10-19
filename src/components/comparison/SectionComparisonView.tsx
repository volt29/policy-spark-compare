import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Shield, Heart, AlertTriangle } from "lucide-react";
import { SourceTooltip } from "./SourceTooltip";
import { cn } from "@/lib/utils";
import type { ComparisonAnalysisOffer } from "@/types/comparison";
import type { ComparisonOffer } from "@/lib/comparison-utils";

const SECTION_CONFIG = [
  {
    key: "price" as const,
    title: "Składki i ceny",
    description: "Porównanie kosztów i zmian względem średniej",
    icon: DollarSign,
  },
  {
    key: "coverage" as const,
    title: "Zakres ochrony",
    description: "Najważniejsze informacje o sumach ubezpieczenia i limitach",
    icon: Shield,
  },
  {
    key: "assistance" as const,
    title: "Assistance i dodatki",
    description: "Usługi dodatkowe oraz świadczenia w pakietach",
    icon: Heart,
  },
  {
    key: "exclusions" as const,
    title: "Wyłączenia i ograniczenia",
    description: "Ostrzeżenia dotyczące ograniczeń odpowiedzialności",
    icon: AlertTriangle,
  },
];

type SectionKey = (typeof SECTION_CONFIG)[number]["key"];

type AnalysisMap = Record<SectionKey, Array<ComparisonAnalysisOffer | undefined>>;

const getHighlightBadge = (highlight?: string | null) => {
  if (highlight === "best") {
    return (
      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-200">
        Rekomendacja AI
      </Badge>
    );
  }
  if (highlight === "warning") {
    return (
      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-200">
        Ostrzeżenie
      </Badge>
    );
  }
  return null;
};

const extractMessage = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const message = extractMessage(entry);
      if (message) {
        return message;
      }
    }
    return null;
  }
  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      const message = extractMessage(entry);
      if (message) {
        return message;
      }
    }
  }
  return null;
};

const getAnalysisSummary = (analysis?: ComparisonAnalysisOffer): string | null => {
  if (!analysis) return null;
  if (typeof analysis.note === "string" && analysis.note.trim().length > 0) {
    return analysis.note.trim();
  }
  return extractMessage(analysis.value);
};

interface SectionComparisonViewProps {
  offers: ComparisonOffer[];
  priceAnalyses: Array<ComparisonAnalysisOffer | undefined>;
  coverageAnalyses: Array<ComparisonAnalysisOffer | undefined>;
  assistanceAnalyses: Array<ComparisonAnalysisOffer | undefined>;
  exclusionsAnalyses: Array<ComparisonAnalysisOffer | undefined>;
}

export function SectionComparisonView({
  offers,
  priceAnalyses,
  coverageAnalyses,
  assistanceAnalyses,
  exclusionsAnalyses,
}: SectionComparisonViewProps) {
  const analyses: AnalysisMap = {
    price: priceAnalyses,
    coverage: coverageAnalyses,
    assistance: assistanceAnalyses,
    exclusions: exclusionsAnalyses,
  };

  return (
    <div className="space-y-6">
      {SECTION_CONFIG.map((section) => {
        const Icon = section.icon;
        const sectionAnalyses = analyses[section.key];
        const hasAnyData = sectionAnalyses.some((analysis) => Boolean(analysis));

        return (
          <Card key={section.key} className="shadow-elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon className={cn("h-5 w-5 text-primary")} />
                {section.title}
              </CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {hasAnyData ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {offers.map((offer, idx) => {
                    const analysis = sectionAnalyses[idx];
                    const summary = getAnalysisSummary(analysis);
                    return (
                      <div key={offer.id} className="rounded-lg border border-muted bg-background/60 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Oferta</p>
                            <p className="text-base font-semibold text-foreground">{offer.insurer}</p>
                          </div>
                          {getHighlightBadge(analysis?.highlight)}
                        </div>
                        {summary ? (
                          <SourceTooltip reference={analysis?.sources}>
                            <p className="text-sm leading-relaxed text-foreground/80">{summary}</p>
                          </SourceTooltip>
                        ) : (
                          <p className="text-sm text-muted-foreground">Brak komentarza AI dla tej oferty.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Brak danych AI dla tej sekcji.</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
