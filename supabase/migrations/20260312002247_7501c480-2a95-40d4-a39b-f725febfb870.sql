
-- Create public bucket for processed product images
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their workspace folder
CREATE POLICY "Users can upload product images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND auth.uid() IS NOT NULL
);

-- Allow public read access (CDN)
CREATE POLICY "Public read product images"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'product-images');

-- Allow users to delete their own images
CREATE POLICY "Users can delete own product images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'product-images'
  AND auth.uid() IS NOT NULL
);

-- Image processing credits per workspace
CREATE TABLE IF NOT EXISTS public.image_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  used_this_month integer NOT NULL DEFAULT 0,
  monthly_limit integer NOT NULL DEFAULT 100,
  reset_at timestamptz NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);

ALTER TABLE public.image_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their image credits"
ON public.image_credits FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM workspaces w WHERE w.id = image_credits.workspace_id AND w.user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM workspaces w WHERE w.id = image_credits.workspace_id AND w.user_id = auth.uid()
));
