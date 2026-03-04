
-- Create enum for product status
CREATE TYPE public.product_status AS ENUM ('pending', 'processing', 'optimized', 'published', 'error');

-- Create enum for image status
CREATE TYPE public.image_status AS ENUM ('pending', 'downloading', 'optimizing', 'uploading', 'done', 'error');

-- Create enum for activity action
CREATE TYPE public.activity_action AS ENUM ('upload', 'optimize', 'publish', 'settings_change', 'error');

-- Create products table
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  sku TEXT,
  original_title TEXT,
  optimized_title TEXT,
  original_description TEXT,
  optimized_description TEXT,
  original_price NUMERIC,
  optimized_price NUMERIC,
  category TEXT,
  tags TEXT[],
  meta_title TEXT,
  meta_description TEXT,
  seo_slug TEXT,
  status product_status NOT NULL DEFAULT 'pending',
  woocommerce_id BIGINT,
  supplier_ref TEXT,
  source_file TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create images table
CREATE TABLE public.images (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  original_url TEXT,
  optimized_url TEXT,
  s3_key TEXT,
  alt_text TEXT,
  sort_order INTEGER DEFAULT 0,
  status image_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create settings table (key-value store per user)
CREATE TABLE public.settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, key)
);

-- Create activity_log table
CREATE TABLE public.activity_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  action activity_action NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- RLS policies for products
CREATE POLICY "Users can view their own products" ON public.products FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own products" ON public.products FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own products" ON public.products FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own products" ON public.products FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for images (via product ownership)
CREATE POLICY "Users can view images of their products" ON public.images FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.products WHERE products.id = images.product_id AND products.user_id = auth.uid())
);
CREATE POLICY "Users can create images for their products" ON public.images FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.products WHERE products.id = images.product_id AND products.user_id = auth.uid())
);
CREATE POLICY "Users can update images of their products" ON public.images FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.products WHERE products.id = images.product_id AND products.user_id = auth.uid())
);
CREATE POLICY "Users can delete images of their products" ON public.images FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.products WHERE products.id = images.product_id AND products.user_id = auth.uid())
);

-- RLS policies for settings
CREATE POLICY "Users can view their own settings" ON public.settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own settings" ON public.settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own settings" ON public.settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own settings" ON public.settings FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for activity_log
CREATE POLICY "Users can view their own activity" ON public.activity_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own activity" ON public.activity_log FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_products_user_id ON public.products(user_id);
CREATE INDEX idx_products_status ON public.products(status);
CREATE INDEX idx_products_sku ON public.products(sku);
CREATE INDEX idx_images_product_id ON public.images(product_id);
CREATE INDEX idx_settings_user_key ON public.settings(user_id, key);
CREATE INDEX idx_activity_log_user_id ON public.activity_log(user_id);
CREATE INDEX idx_activity_log_created_at ON public.activity_log(created_at DESC);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
