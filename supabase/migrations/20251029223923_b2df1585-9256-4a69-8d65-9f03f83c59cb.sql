-- Add OCR tracking columns to documents table
ALTER TABLE public.documents 
ADD COLUMN IF NOT EXISTS ocr_text text NULL,
ADD COLUMN IF NOT EXISTS ocr_text_length int NULL,
ADD COLUMN IF NOT EXISTS ocr_provider text NULL,
ADD COLUMN IF NOT EXISTS ocr_fallback_used boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS ocr_extracted_at timestamptz NULL;

-- Add index for OCR text length queries
CREATE INDEX IF NOT EXISTS idx_documents_ocr_text_length 
ON public.documents(ocr_text_length) 
WHERE ocr_text_length IS NOT NULL;

COMMENT ON COLUMN public.documents.ocr_text IS 'Raw OCR text extracted from document';
COMMENT ON COLUMN public.documents.ocr_text_length IS 'Length of OCR text in characters';
COMMENT ON COLUMN public.documents.ocr_provider IS 'OCR provider used (mineru, convertapi)';
COMMENT ON COLUMN public.documents.ocr_fallback_used IS 'Whether fallback OCR provider was used';
COMMENT ON COLUMN public.documents.ocr_extracted_at IS 'Timestamp when OCR was extracted';