
-- Create knowledge_chunks table for full-text search
CREATE TABLE public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid REFERENCES public.uploaded_files(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  chunk_index integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  source_name text,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for full-text search
CREATE INDEX idx_knowledge_chunks_tsv ON public.knowledge_chunks USING GIN (tsv);
CREATE INDEX idx_knowledge_chunks_user ON public.knowledge_chunks (user_id);

-- RLS
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own chunks"
  ON public.knowledge_chunks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own chunks"
  ON public.knowledge_chunks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own chunks"
  ON public.knowledge_chunks FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to search knowledge by relevance
CREATE OR REPLACE FUNCTION public.search_knowledge(
  _user_id uuid,
  _query text,
  _limit integer DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  content text,
  source_name text,
  rank real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    kc.id,
    kc.content,
    kc.source_name,
    ts_rank(kc.tsv, plainto_tsquery('portuguese', _query)) AS rank
  FROM public.knowledge_chunks kc
  WHERE kc.user_id = _user_id
    AND kc.tsv @@ plainto_tsquery('portuguese', _query)
  ORDER BY rank DESC
  LIMIT _limit;
$$;

-- Allow update on uploaded_files for status changes
CREATE POLICY "Users can update their own uploads"
  ON public.uploaded_files FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);
