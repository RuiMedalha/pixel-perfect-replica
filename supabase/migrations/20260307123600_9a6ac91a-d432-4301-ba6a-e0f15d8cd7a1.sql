-- Table for tracking background optimization jobs
CREATE TABLE public.optimization_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id),
  product_ids text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued',
  total_products integer NOT NULL DEFAULT 0,
  processed_products integer NOT NULL DEFAULT 0,
  failed_products integer NOT NULL DEFAULT 0,
  current_product_name text,
  current_phase integer,
  selected_phases integer[] DEFAULT '{}',
  fields_to_optimize text[] DEFAULT '{}',
  model_override text,
  error_message text,
  results jsonb DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.optimization_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own jobs"
ON public.optimization_jobs FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Enable realtime for progress polling
ALTER PUBLICATION supabase_realtime ADD TABLE public.optimization_jobs;