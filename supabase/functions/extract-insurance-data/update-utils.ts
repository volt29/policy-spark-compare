export function ensureRowsUpdated<TRow extends { id: string }>(
  data: TRow[] | null | undefined,
  documentId: string,
  stage: string,
) {
  if (!data || data.length === 0) {
    console.error('Supabase update did not affect any rows', {
      document_id: documentId,
      stage,
    });
    throw new Error(`Supabase update did not affect any rows during ${stage}`);
  }
}
