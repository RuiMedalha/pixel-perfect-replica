
CREATE OR REPLACE FUNCTION public.increment_scraping_credits(_workspace_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.scraping_credits
  SET used_this_month = used_this_month + 1, updated_at = now()
  WHERE workspace_id = _workspace_id;
$$;
