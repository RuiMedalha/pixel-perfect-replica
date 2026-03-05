
-- Add short_description and technical_specs to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS short_description text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS optimized_short_description text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS technical_specs text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_urls text[];

-- Create uploaded_files table to track uploads and prevent duplicates
CREATE TABLE public.uploaded_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  file_size bigint,
  file_hash text,
  file_type text NOT NULL CHECK (file_type IN ('products', 'knowledge')),
  storage_path text,
  status text NOT NULL DEFAULT 'processed',
  products_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own uploads"
  ON public.uploaded_files FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own uploads"
  ON public.uploaded_files FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own uploads"
  ON public.uploaded_files FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create index for duplicate detection
CREATE INDEX idx_uploaded_files_user_hash ON public.uploaded_files (user_id, file_hash);
CREATE INDEX idx_uploaded_files_user_name ON public.uploaded_files (user_id, file_name);
