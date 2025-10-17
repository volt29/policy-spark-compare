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
  // Check unified structure first
  if (extractedData?.unified?.offer_id) {
    return extractedData.unified.offer_id;
  }
  
  // Fallback to old format
  return extractedData?.calculation_id || extractedData?.calculationId;
}

/**
 * Get premium from extracted data (supports both old and new format)
 */
export function getPremium(extractedData: any): number | null {
  // Try unified structure first
  if (extractedData?.unified?.total_premium_after_discounts) {
    const premium = extractedData.unified.total_premium_after_discounts;
    return premium === 'missing' ? null : premium;
  }
  
  // Fallback to old format
  if (extractedData?.premium?.total) {
    return parseFloat(extractedData.premium.total);
  }
  
  return null;
}

/**
 * Check if data uses new unified format
 */
export function hasUnifiedFormat(extractedData: any): boolean {
  return !!extractedData?.unified;
}
