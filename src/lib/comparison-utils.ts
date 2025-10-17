export interface ComparisonOffer {
  id: string;
  insurer: string;
  data: any;
  calculationId?: string;
}

export interface OfferBadges {
  'lowest-price': boolean;
  'highest-coverage': boolean;
  'recommended': boolean;
  'warning': boolean;
}

export function analyzeBestOffers(
  offers: ComparisonOffer[],
  comparisonData: any
): {
  badges: Map<string, Array<keyof OfferBadges>>;
  bestOfferIndex: number;
} {
  const badges = new Map<string, Array<keyof OfferBadges>>();
  let bestOfferIndex = -1;

  // Find lowest premium
  const premiums = offers.map(o => o.data?.premium?.total || Infinity);
  const lowestPremium = Math.min(...premiums);
  const lowestPremiumIndex = premiums.indexOf(lowestPremium);

  // Find highest coverage
  const coverages = offers.map(o => o.data?.coverage?.oc?.sum || 0);
  const highestCoverage = Math.max(...coverages);
  const highestCoverageIndex = coverages.indexOf(highestCoverage);

  // Parse AI recommendations from comparison_data
  const priceOffers = comparisonData?.price_comparison?.offers || [];
  
  offers.forEach((offer, idx) => {
    const offerBadges: Array<keyof OfferBadges> = [];
    
    // Check if lowest price
    if (idx === lowestPremiumIndex && lowestPremium !== Infinity) {
      offerBadges.push('lowest-price');
    }
    
    // Check if highest coverage
    if (idx === highestCoverageIndex && highestCoverage > 0) {
      offerBadges.push('highest-coverage');
    }
    
    // Check AI highlight
    const priceOffer = priceOffers[idx];
    if (priceOffer?.highlight === 'best') {
      offerBadges.push('recommended');
      bestOfferIndex = idx;
    } else if (priceOffer?.highlight === 'warning') {
      offerBadges.push('warning');
    }
    
    badges.set(offer.id, offerBadges);
  });

  // If no "best" from AI, use lowest price as best
  if (bestOfferIndex === -1 && lowestPremiumIndex !== -1) {
    bestOfferIndex = lowestPremiumIndex;
  }

  return { badges, bestOfferIndex };
}

export function extractCalculationId(extractedData: any): string | undefined {
  return extractedData?.calculation_id || extractedData?.calculationId;
}
