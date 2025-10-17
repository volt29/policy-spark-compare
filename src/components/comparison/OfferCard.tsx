import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, Heart, Calendar, TrendingDown, Star, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface OfferCardProps {
  offer: {
    id: string;
    insurer: string;
    data: any;
    calculationId?: string;
  };
  badges?: Array<'lowest-price' | 'highest-coverage' | 'recommended' | 'warning'>;
  isSelected?: boolean;
  onSelect?: () => void;
}

export function OfferCard({ offer, badges = [], isSelected, onSelect }: OfferCardProps) {
  // Support both old and new unified format
  const unified = offer.data?.unified;
  
  const premium = unified && unified.total_premium_after_discounts !== 'missing' 
    ? unified.total_premium_after_discounts 
    : offer.data?.premium?.total;
    
  const currency = offer.data?.premium?.currency || 'PLN';
  
  const ocSum = offer.data?.coverage?.oc?.sum;
  
  const assistanceData = unified?.assistance || offer.data?.assistance;
  const assistanceCount = Array.isArray(assistanceData) ? assistanceData.length : 0;
  
  const period = unified?.duration?.variant 
    ? `${unified.duration.variant} (${calculateMonths(unified.duration.start, unified.duration.end)}m)`
    : offer.data?.period || '12m';
  
  // Show discount info if available
  const hasDiscounts = unified?.discounts && unified.discounts.length > 0;
  const premiumBefore = unified?.total_premium_before_discounts !== 'missing' 
    ? unified?.total_premium_before_discounts 
    : null;

  return (
    <Card 
      className={cn(
        "relative transition-all hover:shadow-lg cursor-pointer",
        isSelected && "ring-2 ring-primary shadow-elevated"
      )}
      onClick={onSelect}
    >
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold leading-tight">{offer.insurer}</h3>
          <div className="flex flex-col gap-1.5">
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
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Premium */}
        <div className="text-center py-4 bg-muted/50 rounded-lg">
          <div className="text-4xl font-bold text-primary">
            {premium ? `${premium.toLocaleString('pl-PL')} ${currency}` : 'Brak danych'}
          </div>
          <div className="text-sm text-muted-foreground mt-1">składka miesięczna</div>
          
          {hasDiscounts && premiumBefore && premiumBefore > premium && (
            <div className="text-xs text-muted-foreground mt-2">
              <span className="line-through">{premiumBefore.toLocaleString('pl-PL')} {currency}</span>
              <span className="text-success ml-2">
                oszczędzasz {(premiumBefore - premium).toLocaleString('pl-PL')} {currency}
              </span>
            </div>
          )}
        </div>

        {/* Key Parameters */}
        <div className="space-y-2">
          {ocSum && (
            <div className="flex items-center gap-2 text-sm">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-muted-foreground">OC:</span>
              <span className="font-medium">{ocSum.toLocaleString('pl-PL')} PLN</span>
            </div>
          )}
          
          {assistanceCount > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Heart className="w-4 h-4 text-primary" />
              <span className="text-muted-foreground">Assistance:</span>
              <span className="font-medium">{assistanceCount} usług</span>
            </div>
          )}
          
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-primary" />
            <span className="text-muted-foreground">Okres:</span>
            <span className="font-medium">{period}</span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col gap-2">
        <Button 
          className="w-full" 
          variant={isSelected ? "default" : "outline"}
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.();
          }}
        >
          {isSelected ? "Wybrano" : "Wybierz ofertę"}
        </Button>
        {offer.calculationId && (
          <div className="text-xs text-muted-foreground text-center">
            ID: {offer.calculationId}
          </div>
        )}
      </CardFooter>
    </Card>
  );
}

// Helper: Calculate months between two dates
function calculateMonths(start: string, end: string): number {
  if (start === 'missing' || end === 'missing') return 12;
  
  try {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + 
                   (endDate.getMonth() - startDate.getMonth());
    return months || 12;
  } catch {
    return 12;
  }
}
