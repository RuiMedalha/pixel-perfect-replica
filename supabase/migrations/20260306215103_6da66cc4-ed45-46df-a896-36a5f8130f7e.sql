-- Add variable product fields to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'simple',
  ADD COLUMN IF NOT EXISTS parent_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attributes jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS image_alt_texts jsonb DEFAULT '[]'::jsonb;

-- Add has_variable_products to workspaces
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS has_variable_products boolean NOT NULL DEFAULT false;

-- Index for finding children of a parent
CREATE INDEX IF NOT EXISTS idx_products_parent_id ON public.products(parent_product_id) WHERE parent_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_product_type ON public.products(product_type) WHERE product_type != 'simple';