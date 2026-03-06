
-- Product versions table for rollback (max 3 per product)
CREATE TABLE public.product_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  optimized_title text,
  optimized_description text,
  optimized_short_description text,
  meta_title text,
  meta_description text,
  seo_slug text,
  tags text[],
  optimized_price numeric,
  faq jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own versions" ON public.product_versions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own versions" ON public.product_versions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own versions" ON public.product_versions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_product_versions_product_id ON public.product_versions(product_id, version_number DESC);

-- Enable realtime for products table (for batch progress)
ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
