ALTER TABLE public.optimization_logs 
  ADD COLUMN IF NOT EXISTS chunks_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rag_match_types jsonb DEFAULT '{}'::jsonb;