
-- Create storage bucket for catalog uploads
INSERT INTO storage.buckets (id, name, public) VALUES ('catalogs', 'catalogs', false);

-- RLS: authenticated users can upload to their own folder
CREATE POLICY "Users can upload catalogs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'catalogs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: users can read their own files
CREATE POLICY "Users can read own catalogs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'catalogs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: users can delete their own files
CREATE POLICY "Users can delete own catalogs" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'catalogs' AND (storage.foldername(name))[1] = auth.uid()::text);
