import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, FileText, Shield, TrendingDown } from "lucide-react";

interface MetricsPanelProps {
  offers: Array<{
    id: string;
    insurer: string;
    data: any;
  }>;
}

export function MetricsPanel({ offers }: MetricsPanelProps) {
  const premiums = offers
    .map(o => o.data?.premium?.total)
    .filter(p => p != null) as number[];
  
  const coverages = offers
    .map(o => o.data?.coverage?.oc?.sum)
    .filter(c => c != null) as number[];

  const offerCount = offers.length;
  const lowestPremium = premiums.length > 0 ? Math.min(...premiums) : 0;
  const avgPremium = premiums.length > 0 ? premiums.reduce((a, b) => a + b, 0) / premiums.length : 0;
  const highestCoverage = coverages.length > 0 ? Math.max(...coverages) : 0;

  const metrics = [
    {
      label: "Liczba ofert",
      value: offerCount.toString(),
      icon: FileText,
      color: "text-primary"
    },
    {
      label: "Najniższa składka",
      value: lowestPremium > 0 ? `${lowestPremium.toLocaleString('pl-PL')} PLN` : "Brak danych",
      icon: TrendingDown,
      color: "text-success"
    },
    {
      label: "Najwyższa ochrona",
      value: highestCoverage > 0 ? `${highestCoverage.toLocaleString('pl-PL')} PLN` : "Brak danych",
      icon: Shield,
      color: "text-blue-600"
    },
    {
      label: "Średnia składka",
      value: avgPremium > 0 ? `${Math.round(avgPremium).toLocaleString('pl-PL')} PLN` : "Brak danych",
      icon: DollarSign,
      color: "text-primary"
    }
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((metric, idx) => {
        const Icon = metric.icon;
        return (
          <Card key={idx}>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className={cn("rounded-full p-2 bg-muted", metric.color)}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-muted-foreground truncate">{metric.label}</div>
                  <div className="text-xl font-bold mt-1 truncate">{metric.value}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
