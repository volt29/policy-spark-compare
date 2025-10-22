import { SourceTooltip } from "@/components/comparison/SourceTooltip";
import type { SourceReference } from "@/types/comparison";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Shield,
  CreditCard,
  Layers,
  TrendingDown,
  Star,
  AlertTriangle,
  Building2,
  Tag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ComparisonOffer } from "@/lib/comparison-utils";
import { getPaymentDisplayInfo } from "@/lib/comparison-utils";

interface OfferCardAnalysisSection {
  sources?: SourceReference[] | null;
}

interface OfferCardAnalysis {
  price?: OfferCardAnalysisSection;
  coverage?: OfferCardAnalysisSection;
  payment?: OfferCardAnalysisSection;
}

export interface OfferCardAction {
  key: string;
  label: string;
  icon: LucideIcon;
  variant?: "default" | "secondary" | "outline" | "ghost";
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
}

interface OfferCardProps {
  offer: ComparisonOffer;
  label: string;
  detectedProductType?: string | null;
  actions?: OfferCardAction[];
  badges?: Array<'lowest-price' | 'highest-coverage' | 'recommended' | 'warning'>;
  isSelected?: boolean;
  onSelect?: () => void;
  analysis?: OfferCardAnalysis;
}

export function OfferCard({
  offer,
  label,
  detectedProductType,
  actions = [],
  badges = [],
  isSelected,
  onSelect,
  analysis,
}: OfferCardProps) {
  // Support both old and new unified format
  const unified = offer.data?.unified;
  
  const premiumValue = unified && unified.total_premium_after_discounts !== 'missing' 
    ? unified.total_premium_after_discounts 
    : offer.data?.premium?.total;
  
  const premium = typeof premiumValue === 'number' ? premiumValue : null;
    
  const currency = offer.data?.premium?.currency || 'PLN';
  
  const paymentInfo = getPaymentDisplayInfo(offer.data);
  const baseContracts = Array.isArray(unified?.base_contracts) ? unified?.base_contracts : [];
  const additionalContracts = Array.isArray(unified?.additional_contracts) ? unified?.additional_contracts : [];
  const assistanceItems = Array.isArray(unified?.assistance) ? unified?.assistance : [];
  const additionalCount = additionalContracts.length + assistanceItems.length;
  const rawCoverageSum =
    (offer.data?.coverage?.oc?.sum ?? offer.data?.coverage?.ac?.sum ?? null) as number | string | null;
  const coverageLabel = (() => {
    if (typeof rawCoverageSum === "number" && Number.isFinite(rawCoverageSum)) {
      return `${rawCoverageSum.toLocaleString("pl-PL")} PLN`;
    }
    if (typeof rawCoverageSum === "string" && rawCoverageSum.trim().length > 0) {
      return rawCoverageSum.trim();
    }
    return null;
  })();
  
  // Show discount info if available
  const hasDiscounts = unified?.discounts && unified.discounts.length > 0;
  const premiumBeforeValue = unified?.total_premium_before_discounts !== 'missing' 
    ? unified?.total_premium_before_discounts 
    : null;
  const premiumBefore = typeof premiumBeforeValue === 'number' ? premiumBeforeValue : null;

  return (
    <Card 
      className={cn(
        "relative transition-all hover:shadow-lg cursor-pointer",
        isSelected && "ring-2 ring-primary shadow-elevated"
      )}
      onClick={onSelect}
    >
      <CardHeader className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Oferta</p>
            <h3 className="text-lg font-semibold leading-tight text-foreground">{label}</h3>
          </div>
          <div className="flex flex-col gap-1.5 items-end">
            {badges.includes('lowest-price') && (
              <Badge variant="default" className="bg-success text-success-foreground gap-1">
                <TrendingDown className="w-3 h-3" />
                Najniższa cena
              </Badge>
            )}
            {badges.includes('recommended') && (
              <Badge variant="default" className="bg-primary gap-1">
                <Star className="w-3 h-3" />
                Rekomendowana
              </Badge>
            )}
            {badges.includes('highest-coverage') && (
              <Badge variant="default" className="bg-blue-600 gap-1">
                <Shield className="w-3 h-3" />
                Najlepszy zakres
              </Badge>
            )}
            {badges.includes('warning') && (
              <Badge variant="default" className="bg-warning text-warning-foreground gap-1">
                <AlertTriangle className="w-3 h-3" />
                Uwaga
              </Badge>
            )}
          </div>
        </div>

        {(offer.insurer || detectedProductType) && (
          <div className="flex flex-wrap items-center gap-2">
            {offer.insurer && (
              <Badge
                variant="outline"
                className="gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                <Building2 className="w-3.5 h-3.5 text-primary" />
                <span>Ubezpieczyciel</span>
                <span className="font-semibold normal-case text-foreground">
                  {offer.insurer}
                </span>
              </Badge>
            )}
            {detectedProductType && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Tag className="w-3.5 h-3.5" />
                {detectedProductType}
              </Badge>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="py-4 bg-muted/50 rounded-lg space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Wysokość składki
          </p>
          <SourceTooltip reference={analysis?.price?.sources}>
            <div className="text-4xl font-bold text-primary">
              {premium ? `${premium.toLocaleString("pl-PL")} ${currency}` : "—"}
            </div>
          </SourceTooltip>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <CreditCard className="w-4 h-4 text-primary" />
            <span>Płatność:</span>
            <SourceTooltip reference={analysis?.payment?.sources ?? analysis?.price?.sources}>
              <span className="font-medium">
                {paymentInfo.hasData ? paymentInfo.primaryLabel : "—"}
              </span>
            </SourceTooltip>
          </div>
          {paymentInfo.secondaryLabels.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Dostępne opcje: {paymentInfo.secondaryLabels.join(", ")}
            </div>
          )}

          {hasDiscounts && premiumBefore && premium && premiumBefore > premium && (
            <div className="text-xs text-muted-foreground">
              <span className="line-through">
                {premiumBefore.toLocaleString("pl-PL")} {currency}
              </span>
              <span className="text-success ml-2">
                oszczędzasz {(premiumBefore - premium).toLocaleString("pl-PL")} {currency}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {coverageLabel && (
            <div className="flex items-center gap-2 text-sm">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-muted-foreground">Zakres podstawowy:</span>
              <SourceTooltip reference={analysis?.coverage?.sources}>
                <span className="font-medium">{coverageLabel}</span>
              </SourceTooltip>
            </div>
          )}

          {baseContracts.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Layers className="w-4 h-4 text-primary" />
              <span className="text-muted-foreground">Umowy podstawowe:</span>
              <span className="font-medium">{baseContracts.length}</span>
            </div>
          )}

          {additionalCount > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Layers className="w-4 h-4 text-primary" />
              <span className="text-muted-foreground">Zakres dodatkowy:</span>
              <span className="font-medium">{additionalCount}</span>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="flex flex-col gap-3">
        {actions.length > 0 && (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.key}
                  className={cn(
                    "w-full justify-center gap-2 sm:flex-1",
                    action.active && "ring-2 ring-primary/60"
                  )}
                  variant={action.variant ?? "outline"}
                  disabled={action.disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    action.onClick?.();
                  }}
                >
                  <Icon className="h-4 w-4" />
                  <span>{action.label}</span>
                </Button>
              );
            })}
          </div>
        )}
        {offer.calculationId && (
          <div className="text-xs text-muted-foreground text-center">
            ID: {offer.calculationId}
          </div>
        )}
      </CardFooter>
    </Card>
  );
}

