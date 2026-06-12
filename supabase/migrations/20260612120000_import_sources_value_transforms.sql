ALTER TABLE public.import_sources
  ADD COLUMN IF NOT EXISTS value_transforms jsonb NOT NULL DEFAULT '{}'::jsonb;
