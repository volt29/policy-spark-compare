ALTER TABLE public.comparisons
  ADD COLUMN IF NOT EXISTS summary_json JSONB;

ALTER TABLE public.comparisons
  ALTER COLUMN summary_text TYPE TEXT USING summary_text::text;

ALTER TABLE public.comparisons
  ALTER COLUMN summary_text DROP NOT NULL;
