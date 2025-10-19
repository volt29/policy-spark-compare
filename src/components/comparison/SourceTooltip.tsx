import { useMemo, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SourceReference } from "@/types/comparison";
import { useDocumentViewer } from "@/contexts/DocumentViewerContext";

interface SourceTooltipProps {
  reference?: SourceReference | SourceReference[] | null;
  children: ReactNode;
  onOpen?: (reference: SourceReference) => void;
  side?: ComponentProps<typeof TooltipContent>["side"];
  align?: ComponentProps<typeof TooltipContent>["align"];
}

const getAdditionalLabel = (count: number) => {
  if (count === 1) return "dodatkowe źródło";
  if (count > 1 && count < 5) return "dodatkowe źródła";
  return "dodatkowych źródeł";
};

export function SourceTooltip({ reference, children, onOpen, side, align }: SourceTooltipProps) {
  const { openDocument } = useDocumentViewer();

  const references = useMemo(() => {
    if (!reference) {
      return [] as SourceReference[];
    }
    const raw = Array.isArray(reference) ? reference : [reference];
    return raw.filter((entry): entry is SourceReference => Boolean(entry?.documentId && entry?.page));
  }, [reference]);

  if (references.length === 0) {
    return <>{children}</>;
  }

  const primary = references[0];
  const snippet = primary.textSnippet.trim();

  const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (onOpen) {
      onOpen(primary);
    } else {
      openDocument(primary);
    }
  };

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className="max-w-xs space-y-3 p-4 text-left">
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Strona {primary.page}
          </p>
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
            {snippet || "Brak podglądu fragmentu"}
          </p>
          <p className="text-[11px] text-muted-foreground">Dokument: {primary.documentId}</p>
        </div>
        <Button type="button" size="sm" variant="outline" className="w-full" onClick={handleOpen}>
          <ExternalLink className="mr-2 h-4 w-4" />
          Otwórz w dokumencie
        </Button>
        {references.length > 1 && (
          <p className="text-center text-[11px] text-muted-foreground">
            + {references.length - 1} {getAdditionalLabel(references.length - 1)}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
