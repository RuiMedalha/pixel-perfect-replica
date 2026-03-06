ALTER TABLE public.products 
  ADD COLUMN IF NOT EXISTS upsell_skus jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS crosssell_skus jsonb DEFAULT '[]'::jsonb;