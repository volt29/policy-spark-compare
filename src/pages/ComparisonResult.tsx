import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDocumentViewer } from "@/contexts/DocumentViewerContext";
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
import { DocumentViewerDialog } from "@/components/comparison/DocumentViewerDialog";
import {
  analyzeBestOffers,
  extractCalculationId,
  createAnalysisLookup,
  findOfferAnalysis,
  type ComparisonOffer,
  type ExtractedOfferData,
} from "@/lib/comparison-utils";
import {
  buildComparisonSections,
  type ComparisonSection,
  type ComparisonSourceMetadata,
  type ComparisonSourceMetadataEntry,
  type ComparisonSourceMetadataRow,
} from "@/lib/buildComparisonSections";
import type { Database } from "@/integrations/supabase/types";
import { toComparisonAnalysis, type SourceReference } from "@/types/comparison";
import { getSignedDownloadUrl, getSignedPreviewUrl } from "@/services/document-service";
import { SignedUrlCache } from "@/services/signed-url-cache";

type ComparisonRow = Database["public"]["Tables"]["comparisons"]["Row"];
type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];

const clampPageNumber = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;

const toNullableNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toNullableString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const toNullableId = (value: unknown): string | number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const parseCoordinates = (value: unknown): SourceReference["coordinates"] | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const x = toNullableNumber(record.x);
  const y = toNullableNumber(record.y);
  const width = toNullableNumber(record.width);
  const height = toNullableNumber(record.height);

  if (x === null || y === null || width === null || height === null) {
    return undefined;
  }

  return { x, y, width, height };
};

const parseSourceReferenceValue = (value: unknown): SourceReference | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const documentIdCandidate =
    record.documentId ?? record.document_id ?? record.document ?? record.source_document;
  const documentIdRaw = toNullableId(documentIdCandidate);
  const pageCandidate =
    record.page ?? record.pageNumber ?? record.page_index ?? record.pageIndex ?? record.index;
  const pageNumber = clampPageNumber(toNullableNumber(pageCandidate) ?? 1);
  const snippetCandidate =
    record.textSnippet ?? record.text_snippet ?? record.snippet ?? record.text ?? record.content;
  const textSnippet = toNullableString(snippetCandidate) ?? "Fragment źródła niedostępny";
  const coordinates = parseCoordinates(record.coordinates ?? record.bounding_box ?? record.bounds);

  if (!documentIdRaw) {
    return null;
  }

  return {
    documentId: String(documentIdRaw),
    page: pageNumber,
    textSnippet,
    ...(coordinates ? { coordinates } : {}),
  } satisfies SourceReference;
};

const parseSourceReferencesValue = (value: unknown): SourceReference[] | null => {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    const references = value
      .map((entry) => parseSourceReferenceValue(entry))
      .filter((entry): entry is SourceReference => Boolean(entry));
    return references.length > 0 ? references : null;
  }

  const single = parseSourceReferenceValue(value);
  return single ? [single] : null;
};

const parseSourceMetadataEntry = (
  value: unknown,
): ComparisonSourceMetadataEntry | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const entry: ComparisonSourceMetadataEntry = {
    offer_id: toNullableId(record.offer_id ?? record.offerId) ?? undefined,
    document_id: toNullableId(record.document_id ?? record.documentId) ?? undefined,
    calculation_id: toNullableId(record.calculation_id ?? record.calculationId) ?? undefined,
    index: toNullableNumber(record.index) ?? undefined,
    source: toNullableString(record.source),
    normalization: toNullableString(record.normalization),
    unit: toNullableString(record.unit),
    note: toNullableString(record.note),
  };

  if (
    entry.offer_id === undefined &&
    entry.document_id === undefined &&
    entry.calculation_id === undefined &&
    entry.index === undefined &&
    !entry.source &&
    !entry.normalization &&
    !entry.unit &&
    !entry.note
  ) {
    return null;
  }

  return entry;
};

const parseSourceMetadataRow = (value: unknown): ComparisonSourceMetadataRow => {
  const base: ComparisonSourceMetadataRow = { label: null, entries: [] };

  if (!value) {
    return base;
  }

  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => parseSourceMetadataEntry(entry))
      .filter((entry): entry is ComparisonSourceMetadataEntry => entry !== null);
    return { label: null, entries };
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entriesValue = record.entries;
    const entries = Array.isArray(entriesValue)
      ? entriesValue
          .map((entry) => parseSourceMetadataEntry(entry))
          .filter((entry): entry is ComparisonSourceMetadataEntry => entry !== null)
      : [parseSourceMetadataEntry(record)].filter(
          (entry): entry is ComparisonSourceMetadataEntry => entry !== null,
        );
    const label = toNullableString(record.label);
    return { label, entries };
  }

  return base;
};

const buildSourceMetadataFromSummary = (
  value: Record<string, unknown>,
): ComparisonSourceMetadata | null => {
  const metadataEntries: ComparisonSourceMetadata = {};

  Object.entries(value).forEach(([key, entryValue]) => {
    if (key === "metrics") {
      return;
    }

    const row = parseSourceMetadataRow(entryValue);
    if (row.entries.length > 0 || row.label) {
      metadataEntries[key] = row;
    }
  });

  return Object.keys(metadataEntries).length > 0 ? metadataEntries : null;
};

type MetricsSourceReferenceMap = Partial<Record<string, SourceReference[]>>;

const extractMetricsSourceReferences = (
  value: Record<string, unknown>,
): MetricsSourceReferenceMap | undefined => {
  const metricsRaw = value.metrics;
  if (!metricsRaw || typeof metricsRaw !== "object") {
    return undefined;
  }

  const references: MetricsSourceReferenceMap = {};

  Object.entries(metricsRaw as Record<string, unknown>).forEach(([key, entryValue]) => {
    const parsed = parseSourceReferencesValue(entryValue);
    if (parsed && parsed.length > 0) {
      references[key] = parsed;
    }
  });

  return Object.keys(references).length > 0 ? references : undefined;
};

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
    return {
      id: doc.id,
      label,
      insurer,
      data: extracted,
      calculationId,
      detectedProductType: detectProductType(extracted),
      fileName: doc.file_name,
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
  const [signedUrlCache] = useState(
    () =>
      new SignedUrlCache({
        preview: (filePath: string) => getSignedPreviewUrl(filePath),
        download: (filePath: string) => getSignedDownloadUrl(filePath),
      })
  );
  const { activeReference, clear } = useDocumentViewer();

  const documentById = useMemo(() => {
    const map = new Map<string, DocumentRow>();
    documents.forEach((doc) => {
      map.set(doc.id, doc);
    });
    return map;
  }, [documents]);

  const fetchPreviewUrl = useCallback(
    (document: DocumentRow) => signedUrlCache.getPreviewUrl(document.file_path),
    [signedUrlCache]
  );

  const fetchDownloadUrl = useCallback(
    (document: DocumentRow) => signedUrlCache.getDownloadUrl(document.file_path),
    [signedUrlCache]
  );

  const buildOfferActions = useCallback(
    (offer: ComparisonOffer, isSelected: boolean): OfferCardAction[] => {
      const notifyUnavailable = (message: string) => {
        toast.info(message, {
          description: offer.fileName ? `Plik: ${offer.fileName}` : undefined,
        });
      };

      const document = documentById.get(offer.id);

      const previewHandler = () => {
        if (!document) {
          notifyUnavailable("Podgląd dokumentu jest niedostępny");
          return;
        }

        void fetchPreviewUrl(document)
          .then((url) => {
            if (!openInNewTab(url)) {
              notifyUnavailable("Podgląd dokumentu jest niedostępny");
            }
          })
          .catch((error) => {
            const description = error instanceof Error ? error.message : undefined;
            toast.error("Nie udało się wczytać podglądu.", { description });
          });
      };

      const downloadHandler = () => {
        if (!document) {
          notifyUnavailable("Nie udało się rozpocząć pobierania");
          return;
        }

        void fetchDownloadUrl(document)
          .then((url) => {
            const newTab = window.open(url, "_blank", "noopener");
            if (!newTab) {
              window.location.href = url;
            }
          })
          .catch((error) => {
            const description = error instanceof Error ? error.message : undefined;
            toast.error("Nie udało się pobrać dokumentu.", { description });
          });
      };

      return [
        {
          key: "preview",
          label: "Podgląd",
          icon: Eye,
          variant: "outline",
          disabled: !document,
          onClick: previewHandler,
        },
        {
          key: "download",
          label: "Pobierz",
          icon: Download,
          variant: "outline",
          disabled: !document,
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
    [documentById, fetchDownloadUrl, fetchPreviewUrl, setSelectedOfferId]
  );

  const loadComparison = useCallback(async () => {
    setLoading(true);
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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Nieznany błąd";
      toast.error("Błąd ładowania porównania", { description: message });
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }

    void loadComparison();
  }, [user, navigate, loadComparison]);

  const comparisonAnalysis = useMemo(
    () =>
      comparison
        ? toComparisonAnalysis(comparison.comparison_data, comparison.summary_text)
        : null,
    [comparison]
  );

  const sourceMetadata = useMemo<ComparisonSourceMetadata | null>(() => {
    const summarySources = comparisonAnalysis?.summary?.sources_map;
    if (!summarySources || typeof summarySources !== "object") {
      return null;
    }

    return buildSourceMetadataFromSummary(summarySources as Record<string, unknown>);
  }, [comparisonAnalysis]);

  const metricsSourceReferences = useMemo<
    Partial<Record<string, SourceReference[] | SourceReference | null>> | undefined
  >(() => {
    const summarySources = comparisonAnalysis?.summary?.sources_map;
    if (!summarySources || typeof summarySources !== "object") {
      return undefined;
    }

    return extractMetricsSourceReferences(summarySources as Record<string, unknown>);
  }, [comparisonAnalysis]);

  const hasStructuredSummary = useMemo(() => {
    const summary = comparisonAnalysis?.summary;
    if (!summary) {
      return false;
    }

    const recommendedOffer = summary.recommended_offer;
    const hasRecommendedOffer = Boolean(recommendedOffer);
    const hasKeyNumbers = (recommendedOffer?.key_numbers?.length ?? 0) > 0;
    const hasReasons = (summary.reasons?.length ?? 0) > 0;
    const hasRisks = (summary.risks?.length ?? 0) > 0;
    const hasNextSteps = (summary.next_steps?.length ?? 0) > 0;

    return hasRecommendedOffer || hasKeyNumbers || hasReasons || hasRisks || hasNextSteps;
  }, [comparisonAnalysis]);

  const offers = useMemo<ComparisonOffer[]>(() => mapDocumentsToOffers(documents), [documents]);

  const { badges, bestOfferIndex } = useMemo(
    () => analyzeBestOffers(offers, comparisonAnalysis),
    [offers, comparisonAnalysis]
  );

  const sections = useMemo<ComparisonSection[]>(
    () => buildComparisonSections(offers, comparisonAnalysis, sourceMetadata),
    [offers, comparisonAnalysis, sourceMetadata]
  );

  const {
    priceAnalyses,
    coverageAnalyses,
    assistanceAnalyses,
    exclusionsAnalyses,
  } = useMemo(() => {
    const priceLookup = createAnalysisLookup(comparisonAnalysis?.price_comparison);
    const coverageLookup = createAnalysisLookup(comparisonAnalysis?.coverage_comparison);
    const assistanceLookup = createAnalysisLookup(comparisonAnalysis?.assistance_comparison);
    const exclusionsLookup = createAnalysisLookup(comparisonAnalysis?.exclusions_diff);

    return {
      priceAnalyses: offers.map((offer, idx) => findOfferAnalysis(priceLookup, offer, idx)),
      coverageAnalyses: offers.map((offer, idx) => findOfferAnalysis(coverageLookup, offer, idx)),
      assistanceAnalyses: offers.map((offer, idx) => findOfferAnalysis(assistanceLookup, offer, idx)),
      exclusionsAnalyses: offers.map((offer, idx) => findOfferAnalysis(exclusionsLookup, offer, idx)),
    };
  }, [comparisonAnalysis, offers]);

  const selectedOffer = offers.find((o) => o.id === selectedOfferId);

  const currentViewerDocument = useMemo(() => {
    if (!viewerState.documentId) {
      return null;
    }
    return documents.find((doc) => doc.id === viewerState.documentId) ?? null;
  }, [documents, viewerState.documentId]);

  useEffect(() => {
    if (!activeReference) {
      return;
    }

    const document = documents.find((doc) => doc.id === activeReference.documentId);
    if (!document) {
      toast.error("Nie znaleziono dokumentu do podglądu.");
      clear();
      return;
    }

    setViewerState({
      isOpen: true,
      documentId: document.id,
      page: clampPageNumber(activeReference.page),
    });
  }, [activeReference, documents, clear]);

  const handleDownloadDocument = useCallback(
    async (document: DocumentRow) => {
      try {
        const signedUrl = await fetchDownloadUrl(document);
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
    [fetchDownloadUrl],
  );

  const handleViewerOpenChange = useCallback(
    (open: boolean) => {
      setViewerState((prev) => ({ ...prev, isOpen: open }));
      if (!open) {
        clear();
      }
    },
    [clear],
  );

  const handleViewerPageChange = useCallback((page: number) => {
    setViewerState((prev) => ({ ...prev, page: clampPageNumber(page) }));
  }, []);

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
              {offers.map((offer, index) => {
                const isSelected = selectedOfferId === offer.id;
                const actions = buildOfferActions(offer, isSelected);
                const priceSources = priceAnalyses[index]?.sources ?? null;
                const coverageSources = coverageAnalyses[index]?.sources ?? null;
                const assistanceSources = assistanceAnalyses[index]?.sources ?? null;
                const hasAnalysis = Boolean(
                  (priceSources && priceSources.length > 0) ||
                    (coverageSources && coverageSources.length > 0) ||
                    (assistanceSources && assistanceSources.length > 0)
                );
                const analysis = hasAnalysis
                  ? {
                      price: priceSources ? { sources: priceSources } : undefined,
                      coverage: coverageSources ? { sources: coverageSources } : undefined,
                      assistance: assistanceSources ? { sources: assistanceSources } : undefined,
                    }
                  : undefined;

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
                    analysis={analysis}
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

          {/* Tab 3: AI Sections */}
          <TabsContent value="sections" className="space-y-6">
            <SectionComparisonView
              offers={offers}
              priceAnalyses={priceAnalyses}
              coverageAnalyses={coverageAnalyses}
              assistanceAnalyses={assistanceAnalyses}
              exclusionsAnalyses={exclusionsAnalyses}
            />
          </TabsContent>

          {/* Tab 4: AI Analysis */}
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
      fetchPreviewUrl={fetchPreviewUrl}
      onDownload={(document) => {
        void handleDownloadDocument(document);
      }}
    />
    </>
  );
}
