
-- Create workspaces table
CREATE TABLE public.workspaces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own workspaces" ON public.workspaces
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own workspaces" ON public.workspaces
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own workspaces" ON public.workspaces
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own workspaces" ON public.workspaces
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Add workspace_id to products, uploaded_files, knowledge_chunks (nullable for now)
ALTER TABLE public.products ADD COLUMN workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL;
ALTER TABLE public.uploaded_files ADD COLUMN workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL;
ALTER TABLE public.knowledge_chunks ADD COLUMN workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL;

-- Create indexes
CREATE INDEX idx_products_workspace ON public.products(workspace_id);
CREATE INDEX idx_uploaded_files_workspace ON public.uploaded_files(workspace_id);
CREATE INDEX idx_knowledge_chunks_workspace ON public.knowledge_chunks(workspace_id);
CREATE INDEX idx_workspaces_user ON public.workspaces(user_id);

-- Create default workspace for each existing user who has products
INSERT INTO public.workspaces (user_id, name, description)
SELECT DISTINCT user_id, 'Geral', 'Workspace padrão'
FROM public.products;

-- Assign existing products to the default workspace
UPDATE public.products p
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.user_id = p.user_id AND w.name = 'Geral';

-- Assign existing uploaded_files
UPDATE public.uploaded_files uf
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.user_id = uf.user_id AND w.name = 'Geral';

-- Assign existing knowledge_chunks
UPDATE public.knowledge_chunks kc
SET workspace_id = w.id
FROM public.workspaces w
WHERE w.user_id = kc.user_id AND w.name = 'Geral';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
