
-- =====================================================
-- 1. FIX ALL RESTRICTIVE RLS POLICIES → PERMISSIVE
-- =====================================================

-- activity_log
DROP POLICY IF EXISTS "Users can create their own activity" ON public.activity_log;
DROP POLICY IF EXISTS "Users can view their own activity" ON public.activity_log;
CREATE POLICY "Users can create their own activity" ON public.activity_log AS PERMISSIVE FOR INSERT TO public WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own activity" ON public.activity_log AS PERMISSIVE FOR SELECT TO public USING (auth.uid() = user_id);

-- categories
DROP POLICY IF EXISTS "Users can create their own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can delete their own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can update their own categories" ON public.categories;
DROP POLICY IF EXISTS "Users can view their own categories" ON public.categories;
CREATE POLICY "Users can create their own categories" ON public.categories AS PERMISSIVE FOR INSERT TO public WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own categories" ON public.categories AS PERMISSIVE FOR DELETE TO public USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own categories" ON public.categories AS PERMISSIVE FOR UPDATE TO public USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own categories" ON public.categories AS PERMISSIVE FOR SELECT TO public USING (auth.uid() = user_id);

-- images
DROP POLICY IF EXISTS "Users can create images for their products" ON public.images;
DROP POLICY IF EXISTS "Users can delete images of their products" ON public.images;
DROP POLICY IF EXISTS "Users can update images of their products" ON public.images;
DROP POLICY IF EXISTS "Users can view images of their products" ON public.images;
CREATE POLICY "Users can create images for their products" ON public.images AS PERMISSIVE FOR INSERT TO public WITH CHECK (EXISTS (SELECT 1 FROM products WHERE products.id = images.product_id AND products.user_id = auth.uid()));
CREATE POLICY "Users can delete images of their products" ON public.images AS PERMISSIVE FOR DELETE TO public USING (EXISTS (SELECT 1 FROM products WHERE products.id = images.product_id AND products.user_id = auth.uid()));
CREATE POLICY "Users can update images of their products" ON public.images AS PERMISSIVE FOR UPDATE TO public USING (EXISTS (SELECT 1 FROM products WHERE products.id = images.product_id AND products.user_id = auth.uid()));
CREATE POLICY "Users can view images of their products" ON public.images AS PERMISSIVE FOR SELECT TO public USING (EXISTS (SELECT 1 FROM products WHERE products.id = images.product_id AND products.user_id = auth.uid()));

-- knowledge_chunks
DROP POLICY IF EXISTS "Users can create their own chunks" ON public.knowledge_chunks;
DROP POLICY IF EXISTS "Users can delete their own chunks" ON public.knowledge_chunks;
DROP POLICY IF EXISTS "Users can view their own chunks" ON public.knowledge_chunks;
CREATE POLICY "Users can create their own chunks" ON public.knowledge_chunks AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own chunks" ON public.knowledge_chunks AS PERMISSIVE FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own chunks" ON public.knowledge_chunks AS PERMISSIVE FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- optimization_jobs
DROP POLICY IF EXISTS "Users can manage their own jobs" ON public.optimization_jobs;
CREATE POLICY "Users can manage their own jobs" ON public.optimization_jobs AS PERMISSIVE FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- optimization_logs
DROP POLICY IF EXISTS "Users can create their own logs" ON public.optimization_logs;
DROP POLICY IF EXISTS "Users can view their own logs" ON public.optimization_logs;
CREATE POLICY "Users can create their own logs" ON public.optimization_logs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own logs" ON public.optimization_logs AS PERMISSIVE FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- product_versions
DROP POLICY IF EXISTS "Users can create their own versions" ON public.product_versions;
DROP POLICY IF EXISTS "Users can delete their own versions" ON public.product_versions;
DROP POLICY IF EXISTS "Users can update their own versions" ON public.product_versions;
DROP POLICY IF EXISTS "Users can view their own versions" ON public.product_versions;
CREATE POLICY "Users can create their own versions" ON public.product_versions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own versions" ON public.product_versions AS PERMISSIVE FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own versions" ON public.product_versions AS PERMISSIVE FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own versions" ON public.product_versions AS PERMISSIVE FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- products
DROP POLICY IF EXISTS "Users can create their own products" ON public.products;
DROP POLICY IF EXISTS "Users can delete their own products" ON public.products;
DROP POLICY IF EXISTS "Users can update their own products" ON public.products;
DROP POLICY IF EXISTS "Users can view their own products" ON public.products;
CREATE POLICY "Users can create their own products" ON public.products AS PERMISSIVE FOR INSERT TO public WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own products" ON public.products AS PERMISSIVE FOR DELETE TO public USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own products" ON public.products AS PERMISSIVE FOR UPDATE TO public USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own products" ON public.products AS PERMISSIVE FOR SELECT TO public USING (auth.uid() = user_id);

-- profiles
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Admins can update all profiles" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can view all profiles" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can insert their own profile" ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- publish_jobs
DROP POLICY IF EXISTS "Users can manage their own publish jobs" ON public.publish_jobs;
CREATE POLICY "Users can manage their own publish jobs" ON public.publish_jobs AS PERMISSIVE FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- settings
DROP POLICY IF EXISTS "Users can create their own settings" ON public.settings;
DROP POLICY IF EXISTS "Users can delete their own settings" ON public.settings;
DROP POLICY IF EXISTS "Users can update their own settings" ON public.settings;
DROP POLICY IF EXISTS "Users can view their own settings" ON public.settings;
CREATE POLICY "Users can create their own settings" ON public.settings AS PERMISSIVE FOR INSERT TO public WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own settings" ON public.settings AS PERMISSIVE FOR DELETE TO public USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own settings" ON public.settings AS PERMISSIVE FOR UPDATE TO public USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own settings" ON public.settings AS PERMISSIVE FOR SELECT TO public USING (auth.uid() = user_id);

-- uploaded_files
DROP POLICY IF EXISTS "Users can create their own uploads" ON public.uploaded_files;
DROP POLICY IF EXISTS "Users can delete their own uploads" ON public.uploaded_files;
DROP POLICY IF EXISTS "Users can update their own uploads" ON public.uploaded_files;
DROP POLICY IF EXISTS "Users can view their own uploads" ON public.uploaded_files;
CREATE POLICY "Users can create their own uploads" ON public.uploaded_files AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own uploads" ON public.uploaded_files AS PERMISSIVE FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own uploads" ON public.uploaded_files AS PERMISSIVE FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own uploads" ON public.uploaded_files AS PERMISSIVE FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- user_roles
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Admins can manage all roles" ON public.user_roles AS PERMISSIVE FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view their own roles" ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- workspaces
DROP POLICY IF EXISTS "Users can create their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can delete their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can update their own workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Users can view their own workspaces" ON public.workspaces;
CREATE POLICY "Users can create their own workspaces" ON public.workspaces AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own workspaces" ON public.workspaces AS PERMISSIVE FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own workspaces" ON public.workspaces AS PERMISSIVE FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can view their own workspaces" ON public.workspaces AS PERMISSIVE FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- =====================================================
-- 2. CREATE error_logs TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'unknown',
  error_message text NOT NULL,
  stack_trace text,
  context jsonb DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'error',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert their own errors" ON public.error_logs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own errors" ON public.error_logs AS PERMISSIVE FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own errors" ON public.error_logs AS PERMISSIVE FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Index for querying recent errors
CREATE INDEX IF NOT EXISTS idx_error_logs_user_created ON public.error_logs(user_id, created_at DESC);

-- =====================================================
-- 3. CREATE scrape_cache TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.scrape_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  url_hash text NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_markdown text,
  content_html text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  UNIQUE(url_hash, workspace_id)
);

ALTER TABLE public.scrape_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage scrape cache via workspace" ON public.scrape_cache AS PERMISSIVE FOR ALL TO authenticated 
  USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = scrape_cache.workspace_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = scrape_cache.workspace_id AND w.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_scrape_cache_lookup ON public.scrape_cache(url_hash, workspace_id, expires_at);

-- =====================================================
-- 4. CREATE scraping_credits TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.scraping_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE UNIQUE,
  monthly_limit integer NOT NULL DEFAULT 1000,
  used_this_month integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scraping_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their scraping credits" ON public.scraping_credits AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = scraping_credits.workspace_id AND w.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = scraping_credits.workspace_id AND w.user_id = auth.uid()));
