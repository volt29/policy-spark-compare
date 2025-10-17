-- Create bucket for temporary AI input images
INSERT INTO storage.buckets (id, name, public)
VALUES ('tmp-ai-inputs', 'tmp-ai-inputs', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policy: service_role has full access for temporary files
CREATE POLICY "Service role can manage tmp AI inputs"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'tmp-ai-inputs')
WITH CHECK (bucket_id = 'tmp-ai-inputs');