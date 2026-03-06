
CREATE TABLE public.optimization_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  model TEXT NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  knowledge_sources JSONB DEFAULT '[]'::jsonb,
  supplier_name TEXT,
  supplier_url TEXT,
  had_knowledge BOOLEAN DEFAULT false,
  had_supplier BOOLEAN DEFAULT false,
  had_catalog BOOLEAN DEFAULT false,
  fields_optimized TEXT[] DEFAULT '{}',
  prompt_length INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.optimization_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own logs" ON public.optimization_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own logs" ON public.optimization_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_optimization_logs_product ON public.optimization_logs(product_id);
CREATE INDEX idx_optimization_logs_user ON public.optimization_logs(user_id);
