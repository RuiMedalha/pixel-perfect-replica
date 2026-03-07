-- Enable pg_trgm for fuzzy/trigram similarity search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add trigram index on knowledge_chunks content for fuzzy matching
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_content_trgm 
ON public.knowledge_chunks USING gin (content gin_trgm_ops);

-- Add trigram index on source_name for source filtering
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source_trgm 
ON public.knowledge_chunks USING gin (source_name gin_trgm_ops);

-- Create hybrid search function combining FTS + trigram similarity
CREATE OR REPLACE FUNCTION public.search_knowledge_hybrid(
  _query text,
  _workspace_id uuid DEFAULT NULL,
  _family_keywords text DEFAULT NULL,
  _limit integer DEFAULT 15
)
RETURNS TABLE(id uuid, content text, source_name text, rank real, match_type text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Combine FTS results and trigram results, deduplicated
  WITH fts_results AS (
    SELECT 
      kc.id,
      kc.content,
      kc.source_name,
      ts_rank(kc.tsv, plainto_tsquery('portuguese', _query)) AS rank,
      'fts'::text AS match_type
    FROM public.knowledge_chunks kc
    WHERE kc.user_id = auth.uid()
      AND kc.tsv @@ plainto_tsquery('portuguese', _query)
      AND (_workspace_id IS NULL OR kc.workspace_id = _workspace_id)
    ORDER BY rank DESC
    LIMIT _limit
  ),
  trgm_results AS (
    SELECT 
      kc.id,
      kc.content,
      kc.source_name,
      similarity(kc.content, _query)::real AS rank,
      'trigram'::text AS match_type
    FROM public.knowledge_chunks kc
    WHERE kc.user_id = auth.uid()
      AND similarity(kc.content, _query) > 0.05
      AND (_workspace_id IS NULL OR kc.workspace_id = _workspace_id)
    ORDER BY rank DESC
    LIMIT _limit
  ),
  family_results AS (
    SELECT 
      kc.id,
      kc.content,
      kc.source_name,
      similarity(kc.content, _family_keywords)::real * 0.8 AS rank,
      'family'::text AS match_type
    FROM public.knowledge_chunks kc
    WHERE _family_keywords IS NOT NULL 
      AND _family_keywords != ''
      AND kc.user_id = auth.uid()
      AND similarity(kc.content, _family_keywords) > 0.04
      AND (_workspace_id IS NULL OR kc.workspace_id = _workspace_id)
    ORDER BY rank DESC
    LIMIT _limit
  ),
  combined AS (
    SELECT * FROM fts_results
    UNION ALL
    SELECT * FROM trgm_results
    UNION ALL
    SELECT * FROM family_results
  ),
  deduplicated AS (
    SELECT DISTINCT ON (id) id, content, source_name, 
      MAX(rank) OVER (PARTITION BY id) as rank,
      (ARRAY_AGG(match_type) OVER (PARTITION BY id))[1] as match_type
    FROM combined
    ORDER BY id, rank DESC
  )
  SELECT id, content, source_name, rank, match_type
  FROM deduplicated
  ORDER BY rank DESC
  LIMIT _limit;
$$;