import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ComparisonResult() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [comparison, setComparison] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);

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
      setDocuments(docsData);
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

  if (!comparison || !comparison.comparison_data) {
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

  const compData = comparison.comparison_data;
  const offers = documents.map((doc, idx) => ({
    id: idx + 1,
    insurer: doc.extracted_data?.insurer || `Oferta ${idx + 1}`,
    data: doc.extracted_data,
  }));

  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center space-x-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            <span>Powrót do panelu</span>
          </Link>
          <Button variant="outline" disabled>
            <Download className="h-4 w-4 mr-2" />
            Eksportuj PDF (wkrótce)
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8 space-y-6">
        {/* Summary Section */}
        {comparison.summary_text && (
          <Card className="shadow-elevated">
            <CardHeader>
              <CardTitle>Podsumowanie AI</CardTitle>
              <CardDescription>Analiza przygotowana przez sztuczną inteligencję</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed">{comparison.summary_text}</p>
            </CardContent>
          </Card>
        )}

        {/* Key Highlights */}
        {compData.key_highlights && compData.key_highlights.length > 0 && (
          <Card className="shadow-elevated">
            <CardHeader>
              <CardTitle>Najważniejsze różnice</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {compData.key_highlights.map((highlight: string, idx: number) => (
                  <li key={idx} className="flex items-start space-x-2">
                    <span className="text-primary mt-1">•</span>
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Comparison Table */}
        <Card className="shadow-elevated">
          <CardHeader>
            <CardTitle>Szczegółowe porównanie</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 font-semibold">Kategoria</th>
                    {offers.map((offer) => (
                      <th key={offer.id} className="text-left p-3 font-semibold">
                        {offer.insurer}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Coverage */}
                  <tr className="border-b">
                    <td className="p-3 font-medium">Zakres OC</td>
                    {offers.map((offer) => (
                      <td key={offer.id} className="p-3">
                        {offer.data?.coverage?.oc?.sum 
                          ? `${offer.data.coverage.oc.sum.toLocaleString()} ${offer.data.coverage.oc.currency}`
                          : "Brak danych"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="p-3 font-medium">Zakres AC</td>
                    {offers.map((offer) => (
                      <td key={offer.id} className="p-3">
                        {offer.data?.coverage?.ac?.sum 
                          ? `${offer.data.coverage.ac.sum.toLocaleString()} ${offer.data.coverage.ac.currency}`
                          : "Brak danych"}
                      </td>
                    ))}
                  </tr>
                  {/* Premium */}
                  <tr className="border-b bg-muted/50">
                    <td className="p-3 font-medium">Składka</td>
                    {offers.map((offer) => (
                      <td key={offer.id} className="p-3 font-semibold">
                        {offer.data?.premium?.total 
                          ? `${offer.data.premium.total.toLocaleString()} ${offer.data.premium.currency}`
                          : "Brak danych"}
                      </td>
                    ))}
                  </tr>
                  {/* Deductible */}
                  <tr className="border-b">
                    <td className="p-3 font-medium">Franszyza</td>
                    {offers.map((offer) => (
                      <td key={offer.id} className="p-3">
                        {offer.data?.deductible?.amount 
                          ? `${offer.data.deductible.amount} ${offer.data.deductible.currency}`
                          : "Brak"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Recommendations */}
        {compData.recommendations && compData.recommendations.length > 0 && (
          <Card className="shadow-elevated">
            <CardHeader>
              <CardTitle>Zalecenia</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {compData.recommendations.map((rec: string, idx: number) => (
                  <li key={idx} className="flex items-start space-x-2">
                    <span className="text-primary mt-1">→</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
