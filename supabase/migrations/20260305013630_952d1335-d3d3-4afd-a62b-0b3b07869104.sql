
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS faq jsonb DEFAULT null;
ALTER TABLE public.uploaded_files ADD COLUMN IF NOT EXISTS extracted_text text DEFAULT null;
