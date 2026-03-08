ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sale_price numeric NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS optimized_sale_price numeric NULL;

ALTER TABLE public.product_versions ADD COLUMN IF NOT EXISTS optimized_sale_price numeric NULL;