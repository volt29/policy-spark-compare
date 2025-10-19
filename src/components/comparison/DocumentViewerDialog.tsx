import { useEffect, useMemo, useState, type KeyboardEventHandler } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, ArrowRight, Download, FileWarning, Loader2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { getSignedPreviewUrl } from "@/services/document-service";
import { toast } from "sonner";

type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];

type DocumentViewerDialogProps = {
  isOpen: boolean;
  document: DocumentRow | null;
  page: number;
  onOpenChange: (open: boolean) => void;
  onPageChange: (page: number) => void;
  onDownload: (document: DocumentRow) => void;
};

const clampPage = (value: number) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 1);

const isPdfFile = (document: DocumentRow | null) => {
  if (!document) return false;
  const mime = document.mime_type?.toLowerCase();
  if (mime && mime.includes("pdf")) return true;
  return document.file_name.toLowerCase().endsWith(".pdf");
};

const isImageFile = (document: DocumentRow | null) => {
  if (!document) return false;
  const mime = document.mime_type?.toLowerCase();
  if (mime) {
    if (mime.includes("png")) return true;
    if (mime.includes("jpeg") || mime.includes("jpg")) return true;
  }
  const lowered = document.file_name.toLowerCase();
  return lowered.endsWith(".png") || lowered.endsWith(".jpg") || lowered.endsWith(".jpeg");
};

export function DocumentViewerDialog({
  isOpen,
  document,
  page,
  onOpenChange,
  onPageChange,
  onDownload,
}: DocumentViewerDialogProps) {
  const [basePreviewUrl, setBasePreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState(page.toString());

  const previewSupported = useMemo(() => isPdfFile(document) || isImageFile(document), [document]);

  useEffect(() => {
    setPageInput(page.toString());
  }, [page]);

  useEffect(() => {
    if (!isOpen) {
      setBasePreviewUrl(null);
      setPreviewError(null);
      setIsLoading(false);
      return;
    }

    if (!document) {
      setBasePreviewUrl(null);
      setPreviewError(null);
      return;
    }

    if (!previewSupported) {
      setBasePreviewUrl(null);
      setPreviewError("Podgląd nie jest dostępny dla tego typu pliku.");
      return;
    }

    let isCancelled = false;

    const loadPreview = async () => {
      setIsLoading(true);
      setPreviewError(null);

      try {
        const url = await getSignedPreviewUrl(document.file_path);
        if (!isCancelled) {
          setBasePreviewUrl(url);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : undefined;
        if (!isCancelled) {
          setPreviewError(message ?? "Nie udało się załadować podglądu dokumentu.");
        }
        toast.error("Nie udało się wczytać podglądu.", {
          description: message,
        });
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadPreview();

    return () => {
      isCancelled = true;
    };
  }, [document, isOpen, previewSupported]);

  const displayUrl = useMemo(() => {
    if (!basePreviewUrl) return null;
    if (document && isPdfFile(document)) {
      const safePage = clampPage(page);
      return `${basePreviewUrl}#page=${safePage}`;
    }
    return basePreviewUrl;
  }, [basePreviewUrl, document, page]);

  const handlePageSubmit = () => {
    const parsed = Number(pageInput);
    const safePage = clampPage(parsed);
    onPageChange(safePage);
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handlePageSubmit();
    }
  };

  const renderViewer = () => {
    if (isLoading) {
      return (
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      );
    }

    if (previewError) {
      return (
        <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
          <FileWarning className="h-10 w-10 text-muted-foreground/70" />
          <p>{previewError}</p>
          {document && (
            <Button variant="outline" onClick={() => onDownload(document)}>
              <Download className="mr-2 h-4 w-4" /> Pobierz dokument
            </Button>
          )}
        </div>
      );
    }

    if (!displayUrl) {
      return (
        <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <FileWarning className="h-10 w-10 text-muted-foreground/70" />
          <p>Podgląd dokumentu nie jest dostępny.</p>
        </div>
      );
    }

    if (document && isPdfFile(document)) {
      return (
        <iframe
          key={displayUrl}
          src={displayUrl}
          title={`Podgląd dokumentu ${document.file_name}`}
          className="h-[70vh] w-full rounded-md border"
        />
      );
    }

    if (document && isImageFile(document)) {
      return (
        <ScrollArea className="h-[70vh] w-full rounded-md border">
          <img
            src={displayUrl}
            alt={document.file_name}
            className="h-full w-full object-contain"
          />
        </ScrollArea>
      );
    }

    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <FileWarning className="h-10 w-10 text-muted-foreground/70" />
        <p>Ten typ pliku nie obsługuje podglądu. Skorzystaj z opcji pobierania.</p>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{document?.file_name ?? "Podgląd dokumentu"}</DialogTitle>
          <DialogDescription>
            Sprawdź szczegóły oferty bezpośrednio w przesłanym dokumencie.
          </DialogDescription>
        </DialogHeader>

        {!document ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Wybierz dokument, aby wyświetlić jego podgląd.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>ID dokumentu:</span>
                <span className="font-medium text-foreground">{document.id}</span>
              </div>
              <div className="flex items-center gap-2">
                {isPdfFile(document) && (
                  <div className="flex items-center gap-1 text-sm">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => onPageChange(Math.max(1, page - 1))}
                      disabled={isLoading || page <= 1}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <Input
                      value={pageInput}
                      onChange={(event) => setPageInput(event.target.value)}
                      onBlur={handlePageSubmit}
                      onKeyDown={handleKeyDown}
                      className="h-9 w-20"
                      inputMode="numeric"
                      pattern="[0-9]*"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => onPageChange(page + 1)}
                      disabled={isLoading}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <Button
                  variant="secondary"
                  onClick={() => onDownload(document)}
                  disabled={isLoading}
                >
                  <Download className="mr-2 h-4 w-4" /> Pobierz
                </Button>
              </div>
            </div>

            {renderViewer()}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

