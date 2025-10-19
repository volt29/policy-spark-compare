import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { SourceReference } from "@/types/comparison";

interface DocumentViewerContextValue {
  activeReference: SourceReference | null;
  openDocument: (reference: SourceReference) => void;
  clear: () => void;
}

const DocumentViewerContext = createContext<DocumentViewerContextValue>({
  activeReference: null,
  openDocument: () => {},
  clear: () => {},
});

export const DocumentViewerProvider = ({ children }: { children: ReactNode }) => {
  const [activeReference, setActiveReference] = useState<SourceReference | null>(null);

  const openDocument = useCallback((reference: SourceReference) => {
    setActiveReference(reference);
  }, []);

  const clear = useCallback(() => {
    setActiveReference(null);
  }, []);

  const value = useMemo(
    () => ({
      activeReference,
      openDocument,
      clear,
    }),
    [activeReference, openDocument, clear],
  );

  return <DocumentViewerContext.Provider value={value}>{children}</DocumentViewerContext.Provider>;
};

export const useDocumentViewer = () => useContext(DocumentViewerContext);
