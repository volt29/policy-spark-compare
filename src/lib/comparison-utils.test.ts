// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { analyzeBestOffers, extractCalculationId, type ComparisonOffer } from "./comparison-utils";
import { toComparisonAnalysis } from "@/types/comparison";

describe("analyzeBestOffers", () => {
  const createOffer = (
    id: string,
    premium: number,
    options: Partial<ComparisonOffer> = {}
  ): ComparisonOffer => ({
    id,
    label: options.label ?? `Oferta ${id}`,
    insurer: options.insurer ?? `Offer ${id}`,
    data: {
      premium: { total: premium },
      coverage: { oc: { sum: 50000 } },
      unified: { offer_id: options.calculationId ?? null, total_premium_after_discounts: premium },
    },
    calculationId: options.calculationId ?? null,
    detectedProductType: options.detectedProductType ?? null,
    fileName: options.fileName,
    previewUrl: options.previewUrl,
    downloadUrl: options.downloadUrl,
  });

  it("aligns AI highlights using calculation identifiers when order differs", () => {
    const offers: ComparisonOffer[] = [
      createOffer("doc-1", 1200, { calculationId: "calc-A" }),
      createOffer("doc-2", 1000, { calculationId: "calc-B" }),
      createOffer("doc-3", 1400, { calculationId: "calc-C" }),
    ];

    const analysis = toComparisonAnalysis({
      price_comparison: {
        offers: [
          { offer_id: "calc-B", highlight: "best" },
          { offer_id: "calc-C", highlight: "warning" },
        ],
      },
    } as any);

    const { badges, bestOfferIndex } = analyzeBestOffers(offers, analysis);

    expect(bestOfferIndex).toBe(1);
    expect(badges.get("doc-2")).toEqual(expect.arrayContaining(["lowest-price", "recommended"]));
    expect(badges.get("doc-3")).toContain("warning");
    expect(badges.get("doc-1")).not.toContain("recommended");
    expect(badges.get("doc-1")).not.toContain("warning");
  });

  it("falls back to index matching when identifiers are missing", () => {
    const offers: ComparisonOffer[] = [
      createOffer("doc-1", 1500),
      createOffer("doc-2", 900),
    ];

    const analysis = toComparisonAnalysis({
      price_comparison: {
        offers: [
          { highlight: "warning" },
          { highlight: "best" },
        ],
      },
    } as any);

    const { badges, bestOfferIndex } = analyzeBestOffers(offers, analysis);

    expect(bestOfferIndex).toBe(1);
    expect(badges.get("doc-1")).toContain("warning");
    expect(badges.get("doc-2")).toEqual(expect.arrayContaining(["lowest-price", "recommended"]));
  });

  it("marks the cheapest offer when AI data provides no recommendation", () => {
    const offers: ComparisonOffer[] = [
      createOffer("doc-1", 1300),
      createOffer("doc-2", 1250),
      createOffer("doc-3", 1500),
    ];

    const { badges, bestOfferIndex } = analyzeBestOffers(offers, null);

    expect(bestOfferIndex).toBe(1);
    expect(badges.get("doc-2")).toContain("lowest-price");
  });
});

describe("extractCalculationId", () => {
  it("prefers unified offer id when available", () => {
    expect(
      extractCalculationId({
        unified: { offer_id: "calc-123", total_premium_after_discounts: 1000 },
      })
    ).toBe("calc-123");
  });

  it("falls back to legacy fields", () => {
    expect(extractCalculationId({ calculation_id: "legacy" } as any)).toBe("legacy");
    expect(extractCalculationId({ calculationId: "camel" } as any)).toBe("camel");
  });
});
