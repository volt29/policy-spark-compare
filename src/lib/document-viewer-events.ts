export const DOCUMENT_TOOLTIP_EVENT = "comparison:document-tooltip" as const;

export type DocumentTooltipEventDetail = {
  documentId: string;
  page?: number;
};

export const emitDocumentTooltipEvent = (detail: DocumentTooltipEventDetail) => {
  window.dispatchEvent(new CustomEvent<DocumentTooltipEventDetail>(DOCUMENT_TOOLTIP_EVENT, { detail }));
};

