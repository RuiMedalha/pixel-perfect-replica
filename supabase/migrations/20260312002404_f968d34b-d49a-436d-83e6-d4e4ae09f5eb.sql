
CREATE OR REPLACE FUNCTION public.increment_image_credits(_workspace_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.image_credits (workspace_id, used_this_month)
  VALUES (_workspace_id, 1)
  ON CONFLICT (workspace_id) 
  DO UPDATE SET used_this_month = image_credits.used_this_month + 1, updated_at = now();
$$;
