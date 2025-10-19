import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, FileText, Shield, TrendingDown, type LucideIcon } from "lucide-react";
import type { ComparisonOffer } from "@/lib/comparison-utils";
import { SourceTooltip, cn } from "@/lib/utils";
import type { SourceReference } from "@/types/comparison";

type MetricKey = "offerCount" | "lowestPremium" | "highestCoverage" | "averagePremium";

type MetricDefinition = {
  key: MetricKey;
  label: string;
  value: string;
  icon: LucideIcon;
  color: string;
};

interface MetricsPanelProps {
  offers: ComparisonOffer[];
  sourceReferences?: Record<MetricKey, SourceReference[] | SourceReference | null>;
}

export function MetricsPanel({ offers, sourceReferences }: MetricsPanelProps) {
  // Support both old and new unified format
  const premiums = offers
    .map(o => {
      const unified = o.data?.unified;
      if (unified && unified.total_premium_after_discounts !== 'missing') {
        return unified.total_premium_after_discounts;
      }
      return o.data?.premium?.total;
    })
    .filter(p => p != null) as number[];
  
  const coverages = offers
    .map(o => o.data?.coverage?.oc?.sum)
    .filter(c => c != null) as number[];

  const offerCount = offers.length;
  const lowestPremium = premiums.length > 0 ? Math.min(...premiums) : 0;
  const avgPremium = premiums.length > 0 ? premiums.reduce((a, b) => a + b, 0) / premiums.length : 0;
  const highestCoverage = coverages.length > 0 ? Math.max(...coverages) : 0;

  const metrics: MetricDefinition[] = [
    {
      key: "offerCount" as const,
      label: "Liczba ofert",
      value: offerCount.toString(),
      icon: FileText,
      color: "text-primary",
    },
    {
      key: "lowestPremium" as const,
      label: "Najniższa składka",
      value: lowestPremium > 0 ? `${lowestPremium.toLocaleString('pl-PL')} PLN` : "Brak danych",
      icon: TrendingDown,
      color: "text-success",
    },
    {
      key: "highestCoverage" as const,
      label: "Najwyższa ochrona",
      value: highestCoverage > 0 ? `${highestCoverage.toLocaleString('pl-PL')} PLN` : "Brak danych",
      icon: Shield,
      color: "text-blue-600",
    },
    {
      key: "averagePremium" as const,
      label: "Średnia składka",
      value: avgPremium > 0 ? `${Math.round(avgPremium).toLocaleString('pl-PL')} PLN` : "Brak danych",
      icon: DollarSign,
      color: "text-primary",
    },
  ];

  const hasSourceReferences = Boolean(
    sourceReferences && typeof sourceReferences === "object" && Object.keys(sourceReferences).length > 0,
  );

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((metric, idx) => {
        const Icon = metric.icon;
        const reference = hasSourceReferences ? sourceReferences?.[metric.key] ?? null : null;
        return (
          <Card key={idx}>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className={cn("rounded-full p-2 bg-muted", metric.color)}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-muted-foreground truncate">{metric.label}</div>
                  <SourceTooltip reference={reference}>
                    <div className="text-xl font-bold mt-1 truncate">{metric.value}</div>
                  </SourceTooltip>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
