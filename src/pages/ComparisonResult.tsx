import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Download, Loader2, Sparkles, BarChart3, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { OfferCard } from "@/components/comparison/OfferCard";
import { MetricsPanel } from "@/components/comparison/MetricsPanel";
import { ComparisonTable } from "@/components/comparison/ComparisonTable";
import {
  analyzeBestOffers,
  extractCalculationId,
  type ComparisonOffer,
  type ExtractedOfferData,
} from "@/lib/comparison-utils";
import type { Database } from "@/integrations/supabase/types";
import { toComparisonAnalysis } from "@/types/comparison";

type ComparisonRow = Database["public"]["Tables"]["comparisons"]["Row"];
type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];

export default function ComparisonResult() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [comparison, setComparison] = useState<ComparisonRow | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }

    loadComparison();
  }, [id, user, navigate]);

  const loadComparison = async () => {
    try {
      const { data: compData, error: compError } = await supabase
        .from("comparisons")
        .select("*")
        .eq("id", id)
        .single();

      if (compError) throw compError;

      const { data: docsData, error: docsError } = await supabase
        .from("documents")
        .select("*")
        .in("id", compData.document_ids);

      if (docsError) throw docsError;

      setComparison(compData);
      setDocuments(docsData ?? []);
    } catch (error: any) {
      toast.error("Błąd ładowania porównania", { description: error.message });
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const comparisonAnalysis = useMemo(
    () => (comparison ? toComparisonAnalysis(comparison.comparison_data) : null),
    [comparison]
  );

  if (!comparison || !comparisonAnalysis) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Brak danych</CardTitle>
            <CardDescription>Porównanie nie jest jeszcze gotowe</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/dashboard")}>
              Wróć do panelu
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const offers = useMemo<ComparisonOffer[]>(() => {
    return documents.map((doc, idx) => {
      const extracted = (doc.extracted_data ?? null) as ExtractedOfferData | null;
      const insurerName =
        typeof extracted?.insurer === "string" && extracted.insurer.trim().length > 0
          ? extracted.insurer
          : `Oferta ${idx + 1}`;

      return {
        id: doc.id,
        insurer: insurerName,
        data: extracted,
        calculationId: extractCalculationId(extracted),
      } satisfies ComparisonOffer;
    });
  }, [documents]);

  const { badges, bestOfferIndex } = useMemo(() => analyzeBestOffers(offers, comparisonAnalysis), [offers, comparisonAnalysis]);
  const selectedOffer = offers.find(o => o.id === selectedOfferId);

  const handleConfirmSelection = () => {
    if (!selectedOffer) return;
    localStorage.setItem(`comparison_${id}_selected`, selectedOfferId!);
    toast.success("Oferta została zapisana!", {
      description: `Wybrano: ${selectedOffer.insurer}`
    });
  };

  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Sticky Header */}
      <div className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center space-x-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            <span>Powrót do panelu</span>
          </Link>
          <Button variant="outline" disabled>
            <Download className="h-4 w-4 mr-2" />
            Eksportuj PDF (wkrótce)
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8 space-y-6">
        {/* Metrics Panel */}
        <MetricsPanel offers={offers} />

        {/* Tabbed Interface */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview" className="gap-2">
              <BarChart3 className="w-4 h-4" />
              Przegląd ofert
            </TabsTrigger>
            <TabsTrigger value="details" className="gap-2">
              <ListChecks className="w-4 h-4" />
              Szczegółowe porównanie
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Sparkles className="w-4 h-4" />
              Analiza AI
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Offer Overview */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {offers.map((offer, idx) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  badges={badges.get(offer.id) || []}
                  isSelected={selectedOfferId === offer.id}
                  onSelect={() => setSelectedOfferId(offer.id === selectedOfferId ? null : offer.id)}
                />
              ))}
            </div>
          </TabsContent>

          {/* Tab 2: Detailed Comparison */}
          <TabsContent value="details">
            <ComparisonTable offers={offers} bestOfferIndex={bestOfferIndex} />
          </TabsContent>

          {/* Tab 3: AI Analysis */}
          <TabsContent value="ai" className="space-y-6">
            {/* AI Summary */}
            {comparison.summary_text && (
              <Card className="shadow-elevated">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    Podsumowanie AI
                  </CardTitle>
                  <CardDescription>Analiza przygotowana przez sztuczną inteligencję</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-foreground leading-relaxed whitespace-pre-line">{comparison.summary_text}</p>
                </CardContent>
              </Card>
            )}

            {/* Key Highlights */}
            {comparisonAnalysis.key_highlights && comparisonAnalysis.key_highlights.length > 0 && (
              <Card className="shadow-elevated">
                <CardHeader>
                  <CardTitle>Najważniejsze różnice</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {comparisonAnalysis.key_highlights.map((highlight: string, idx: number) => (
                      <li key={idx} className="flex items-start space-x-3 p-3 rounded-lg bg-muted/50">
                        <span className="text-primary mt-1 font-bold">•</span>
                        <span className="flex-1">{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Recommendations */}
            {comparisonAnalysis.recommendations && comparisonAnalysis.recommendations.length > 0 && (
              <Card className="shadow-elevated border-primary/20">
                <CardHeader>
                  <CardTitle>Zalecenia</CardTitle>
                  <CardDescription>Rekomendacje na podstawie analizy ofert</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {comparisonAnalysis.recommendations.map((rec: string, idx: number) => (
                      <li key={idx} className="flex items-start space-x-3 p-3 rounded-lg bg-primary/5">
                        <span className="text-primary mt-1 font-bold">→</span>
                        <span className="flex-1">{rec}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Sticky Offer Selector (Bottom) */}
      {selectedOfferId && selectedOffer && (
        <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t shadow-elevated z-40 animate-fade-in">
          <div className="container mx-auto px-4 py-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-lg truncate">
                  Wybrana oferta: {selectedOffer.insurer}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedOffer.calculationId && `ID kalkulacji: ${selectedOffer.calculationId}`}
                  {selectedOffer.data?.premium?.total && ` • ${selectedOffer.data.premium.total.toLocaleString('pl-PL')} ${selectedOffer.data.premium.currency || 'PLN'}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setSelectedOfferId(null)}>
                  Anuluj
                </Button>
                <Button onClick={handleConfirmSelection}>
                  Potwierdź wybór
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
