
-- Create publish_jobs table
CREATE TABLE public.publish_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id),
  status text NOT NULL DEFAULT 'queued',
  total_products integer NOT NULL DEFAULT 0,
  processed_products integer NOT NULL DEFAULT 0,
  failed_products integer NOT NULL DEFAULT 0,
  current_product_name text,
  product_ids text[] NOT NULL DEFAULT '{}',
  publish_fields text[] DEFAULT '{}',
  pricing jsonb,
  results jsonb DEFAULT '[]'::jsonb,
  scheduled_for timestamp with time zone,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.publish_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own publish jobs"
  ON public.publish_jobs
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- updated_at trigger
CREATE TRIGGER update_publish_jobs_updated_at
  BEFORE UPDATE ON public.publish_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.publish_jobs;
