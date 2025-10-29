-- Add summary_json column to comparisons table
ALTER TABLE public.comparisons 
ADD COLUMN summary_json jsonb;