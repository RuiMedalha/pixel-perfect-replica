CREATE OR REPLACE FUNCTION public.search_knowledge(_query text, _workspace_id uuid DEFAULT NULL, _limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, content text, source_name text, rank real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT 
    kc.id,
    kc.content,
    kc.source_name,
    ts_rank(kc.tsv, plainto_tsquery('portuguese', _query)) AS rank
  FROM public.knowledge_chunks kc
  WHERE kc.user_id = auth.uid()
    AND kc.tsv @@ plainto_tsquery('portuguese', _query)
    AND (_workspace_id IS NULL OR kc.workspace_id = _workspace_id)
  ORDER BY rank DESC
  LIMIT _limit;
$$;