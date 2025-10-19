import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Download,
  Eye,
  Loader2,
  Sparkles,
  BarChart3,
  ListChecks,
  CheckCircle2,
  AlertTriangle,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { OfferCard, type OfferCardAction } from "@/components/comparison/OfferCard";
import { MetricsPanel } from "@/components/comparison/MetricsPanel";
import { ComparisonTable } from "@/components/comparison/ComparisonTable";
import { SectionComparisonView } from "@/components/comparison/SectionComparisonView";
import { SourceTooltip } from "@/components/comparison/SourceTooltip";
import {
  analyzeBestOffers,
  extractCalculationId,
  createAnalysisLookup,
  findOfferAnalysis,
  getPremium,
  type ComparisonOffer,
  type ExtractedOfferData,
} from "@/lib/comparison-utils";
import {
  buildComparisonSections,
  type ComparisonSection,
  type ComparisonSourceMetadata,
} from "@/lib/buildComparisonSections";
import type { Database } from "@/integrations/supabase/types";
import { toComparisonAnalysis, type SourceReference } from "@/types/comparison";

type ComparisonRow = Database["public"]["Tables"]["comparisons"]["Row"];
type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];

const DOCUMENTS_BUCKET = "documents";

const normalizeString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const detectProductType = (data: ExtractedOfferData | null): string | null => {
  if (!data) return null;

  const unifiedRecord = data.unified && typeof data.unified === "object"
    ? (data.unified as Record<string, unknown>)
    : null;

  const candidates: Array<unknown> = [
    (data as Record<string, unknown> | null)?.product_type,
    (data as Record<string, unknown> | null)?.detected_product_type,
    unifiedRecord?.product_type,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const getDocumentPublicUrl = (filePath: string | null | undefined): string | null => {
  if (!filePath) return null;
  try {
    const { data } = supabase.storage.from(DOCUMENTS_BUCKET).getPublicUrl(filePath);
    return data?.publicUrl ?? null;
  } catch (error) {
    console.warn("Nie udało się zbudować adresu URL dokumentu", error);
    return null;
  }
};

const createDownloadUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("download", "1");
    return parsed.toString();
  } catch (error) {
    console.warn("Nie udało się zbudować adresu pobierania", error);
    return url;
  }
};

const openInNewTab = (url: string | null | undefined): boolean => {
  if (!url || typeof window === "undefined") {
    return false;
  }

  const newWindow = window.open(url, "_blank", "noopener,noreferrer");
  return !!newWindow;
};

const mapDocumentsToOffers = (documents: DocumentRow[]): ComparisonOffer[] => {
  return documents.map((doc, idx) => {
    const extracted = (doc.extracted_data ?? null) as ExtractedOfferData | null;
    const label = `Oferta ${idx + 1}`;
    const insurer = normalizeString(extracted?.insurer);
    const calculationId = extractCalculationId(extracted);
    const previewUrl = getDocumentPublicUrl(doc.file_path);

    return {
      id: doc.id,
      label,
      insurer,
      data: extracted,
      calculationId,
      detectedProductType: detectProductType(extracted),
      fileName: doc.file_name,
      previewUrl,
      downloadUrl: createDownloadUrl(previewUrl),
    } satisfies ComparisonOffer;
  });
};

export default function ComparisonResult() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [comparison, setComparison] = useState<ComparisonRow | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [viewerState, setViewerState] = useState({
    isOpen: false,
    documentId: null as string | null,
    page: 1,
  });

  const buildOfferActions = useCallback(
    (offer: ComparisonOffer, isSelected: boolean): OfferCardAction[] => {
      const notifyUnavailable = (message: string) => {
        toast.info(message, {
          description: offer.fileName ? `Plik: ${offer.fileName}` : undefined,
        });
      };

      const previewHandler = () => {
        if (!openInNewTab(offer.previewUrl)) {
          notifyUnavailable("Podgląd dokumentu jest niedostępny");
        }
      };

      const downloadHandler = () => {
        const targetUrl = offer.downloadUrl ?? offer.previewUrl;
        if (!openInNewTab(targetUrl)) {
          notifyUnavailable("Nie udało się rozpocząć pobierania");
        }
      };

      return [
        {
          key: "preview",
          label: "Podgląd",
          icon: Eye,
          variant: "outline",
          disabled: !offer.previewUrl,
          onClick: previewHandler,
        },
        {
          key: "download",
          label: "Pobierz",
          icon: Download,
          variant: "outline",
          disabled: !(offer.downloadUrl ?? offer.previewUrl),
          onClick: downloadHandler,
        },
        {
          key: "select",
          label: isSelected ? "Wybrano" : "Wybierz ofertę",
          icon: CheckCircle,
          variant: isSelected ? "default" : "secondary",
          active: isSelected,
          onClick: () => {
            setSelectedOfferId((current) => (current === offer.id ? null : offer.id));
          },
        },
      ];
    },
    [setSelectedOfferId]
  );

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

  const comparisonAnalysis = useMemo(
    () =>
      comparison
        ? toComparisonAnalysis(comparison.comparison_data, comparison.summary_text)
        : null,
    [comparison]
  );

  const offers = useMemo<ComparisonOffer[]>(() => mapDocumentsToOffers(documents), [documents]);

  const { badges, bestOfferIndex } = useMemo(
    () => analyzeBestOffers(offers, comparisonAnalysis),
    [offers, comparisonAnalysis]
  );

  const sections = useMemo<ComparisonSection[]>(
    () => buildComparisonSections(offers, comparisonAnalysis, sourceMetadata),
    [offers, comparisonAnalysis, sourceMetadata]
  );

  const selectedOffer = offers.find((o) => o.id === selectedOfferId);

  const currentViewerDocument = useMemo(() => {
    if (!viewerState.documentId) {
      return null;
    }
    return documents.find((doc) => doc.id === viewerState.documentId) ?? null;
  }, [documents, viewerState.documentId]);

  const openDocumentPreview = useCallback(
    (documentId: string, page = 1) => {
      const document = documents.find((doc) => doc.id === documentId);
      if (!document) {
        toast.error("Nie znaleziono dokumentu do podglądu.");
        return;
      }

      setViewerState({
        isOpen: true,
        documentId: document.id,
        page: clampPageNumber(Number(page)),
      });
    },
    [documents],
  );

  const handleDownloadDocument = useCallback(
    async (documentId: string) => {
      const document = documents.find((doc) => doc.id === documentId);
      if (!document) {
        toast.error("Nie znaleziono dokumentu do pobrania.");
        return;
      }

      try {
        const signedUrl = await getSignedDownloadUrl(document.file_path);
        const newTab = window.open(signedUrl, "_blank", "noopener");
        if (!newTab) {
          window.location.href = signedUrl;
        }
      } catch (error) {
        const description = error instanceof Error ? error.message : undefined;
        toast.error("Nie udało się pobrać dokumentu.", {
          description,
        });
      }
    },
    [documents],
  );

  const handleViewerOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setViewerState((prev) => ({ ...prev, isOpen: false }));
    }
  }, []);

  const handleViewerPageChange = useCallback((page: number) => {
    setViewerState((prev) => ({ ...prev, page: clampPageNumber(page) }));
  }, []);

  useEffect(() => {
    const listener = ((event: Event) => {
      const detail = (event as CustomEvent<DocumentTooltipEventDetail>).detail;
      if (!detail?.documentId) {
        return;
      }
      openDocumentPreview(detail.documentId, detail.page ?? 1);
    }) as EventListener;

    window.addEventListener(DOCUMENT_TOOLTIP_EVENT, listener);
    return () => {
      window.removeEventListener(DOCUMENT_TOOLTIP_EVENT, listener);
    };
  }, [openDocumentPreview]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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

  const summaryData = comparisonAnalysis.summary ?? null;
  const recommendedOffer = summaryData?.recommended_offer ?? null;
  const recommendedOfferInsurerName = recommendedOffer?.insurer ?? null;
  const recommendedOfferMatch = recommendedOfferInsurerName
    ? offers.find(
        (offer) =>
          offer.insurer && offer.insurer.toLowerCase() === recommendedOfferInsurerName.toLowerCase(),
      )
    : null;
  const keyNumbers = recommendedOffer?.key_numbers ?? [];
  const recommendedOfferTitle =
    recommendedOffer?.name ??
    recommendedOfferMatch?.label ??
    recommendedOfferInsurerName ??
    null;
  const recommendedOfferInsurer =
    recommendedOfferInsurerName && recommendedOfferInsurerName !== recommendedOfferTitle
      ? recommendedOfferMatch?.insurer ?? recommendedOfferInsurerName
      : null;
  const fallbackSummaryText =
    summaryData?.fallback_text ??
    summaryData?.raw_text ??
    (typeof comparison.summary_text === "string" ? comparison.summary_text : null);
  const hasStructuredSummary =
    !!summaryData &&
    (Boolean(
      recommendedOffer &&
        (recommendedOfferTitle || recommendedOffer.summary || keyNumbers.length > 0)
    ) ||
      (summaryData.reasons?.length ?? 0) > 0 ||
      (summaryData.risks?.length ?? 0) > 0 ||
      (summaryData.next_steps?.length ?? 0) > 0);

  const handleConfirmSelection = () => {
    if (!selectedOffer) return;
    localStorage.setItem(`comparison_${id}_selected`, selectedOfferId!);
    toast.success("Oferta została zapisana!", {
      description: `Wybrano: ${selectedOffer.insurer ?? selectedOffer.label}`
    });
  };

  return (
    <>
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
        <MetricsPanel offers={offers} sourceReferences={metricsSourceReferences} />

        {/* Tabbed Interface */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview" className="gap-2">
              <BarChart3 className="w-4 h-4" />
              Przegląd ofert
            </TabsTrigger>
            <TabsTrigger value="details" className="gap-2">
              <ListChecks className="w-4 h-4" />
              Szczegółowe porównanie
            </TabsTrigger>
            <TabsTrigger value="sections" className="gap-2">
              <Layers className="w-4 h-4" />
              Sekcje AI
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Sparkles className="w-4 h-4" />
              Analiza AI
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Offer Overview */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {offers.map((offer) => {
                const isSelected = selectedOfferId === offer.id;
                const actions = buildOfferActions(offer, isSelected);
                return (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  label={offer.label}
                  detectedProductType={offer.detectedProductType}
                  badges={badges.get(offer.id) || []}
                  isSelected={isSelected}
                  onSelect={() => setSelectedOfferId((current) => (current === offer.id ? null : offer.id))}
                  actions={actions}
                />
                );
              })}
            </div>
          </TabsContent>

          {/* Tab 2: Detailed Comparison */}
          <TabsContent value="details">
            <ComparisonTable
              comparisonId={comparison.id}
              offers={offers}
              bestOfferIndex={bestOfferIndex}
              sections={sections}
            />
          </TabsContent>

          {/* Tab 3: AI Analysis */}
          <TabsContent value="ai" className="space-y-6">
            {/* AI Summary */}
            {(hasStructuredSummary || fallbackSummaryText) && (
              <Card className="shadow-elevated">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    Rekomendacja AI
                  </CardTitle>
                  <CardDescription>
                    Najważniejsze wskazówki przygotowane na podstawie analizy ofert
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {hasStructuredSummary && (
                    <div className="space-y-6">
                      {recommendedOffer && (
                        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Rekomendowana oferta
                          </p>
                          {recommendedOfferTitle && (
                            <p className="mt-1 text-2xl font-semibold text-primary">
                              {recommendedOfferTitle}
                            </p>
                          )}
                          {recommendedOfferInsurer && (
                            <p className="text-sm text-muted-foreground">
                              Towarzystwo: {recommendedOfferInsurer}
                            </p>
                          )}
                          {recommendedOffer.summary && (
                            <p className="mt-4 text-sm leading-relaxed text-foreground/80">
                              {recommendedOffer.summary}
                            </p>
                          )}
                          {keyNumbers.length > 0 && (
                            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                              {keyNumbers.map((metric, idx) => (
                                <div
                                  key={idx}
                                  className="rounded-lg bg-background/80 px-3 py-2 shadow-sm"
                                >
                                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {metric.label}
                                  </dt>
                                  <SourceTooltip reference={metric.sources}>
                                    <dd className="text-lg font-semibold text-foreground">
                                      {metric.value}
                                    </dd>
                                  </SourceTooltip>
                                </div>
                              ))}
                            </dl>
                          )}
                        </div>
                      )}

                      {summaryData?.reasons && summaryData.reasons.length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            Dlaczego to dobra opcja
                          </h3>
                          <ul className="mt-3 space-y-2">
                            {summaryData.reasons.map((reason, idx) => (
                              <li
                                key={idx}
                                className="flex items-start gap-2 rounded-lg bg-muted/40 p-3"
                              >
                                <CheckCircle2 className="mt-1 h-4 w-4 text-emerald-500" />
                                <span className="text-sm leading-relaxed text-foreground">
                                  {reason}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {summaryData?.risks && summaryData.risks.length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            Na co uważać
                          </h3>
                          <ul className="mt-3 space-y-2">
                            {summaryData.risks.map((risk, idx) => (
                              <li
                                key={idx}
                                className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3"
                              >
                                <AlertTriangle className="mt-1 h-4 w-4 text-destructive" />
                                <span className="text-sm leading-relaxed text-foreground">
                                  {risk}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {summaryData?.next_steps && summaryData.next_steps.length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            Kolejne kroki
                          </h3>
                          <ul className="mt-3 space-y-2">
                            {summaryData.next_steps.map((step, idx) => (
                              <li
                                key={idx}
                                className="flex items-start gap-2 rounded-lg bg-primary/5 p-3"
                              >
                                <ArrowRight className="mt-1 h-4 w-4 text-primary" />
                                <span className="text-sm leading-relaxed text-foreground">
                                  {step}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {!hasStructuredSummary && fallbackSummaryText && (
                    <p className="text-foreground leading-relaxed whitespace-pre-line">
                      {fallbackSummaryText}
                    </p>
                  )}

                  {hasStructuredSummary && fallbackSummaryText && (
                    <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground whitespace-pre-line">
                      {fallbackSummaryText}
                    </div>
                  )}
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
                  Wybrana oferta: {selectedOffer.label}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedOffer.insurer && `Ubezpieczyciel: ${selectedOffer.insurer}`}
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
    <DocumentViewerDialog
      isOpen={viewerState.isOpen}
      document={currentViewerDocument}
      page={viewerState.page}
      onOpenChange={handleViewerOpenChange}
      onPageChange={handleViewerPageChange}
      onDownload={(document) => {
        void handleDownloadDocument(document.id);
      }}
    />
    </>
  );
}
