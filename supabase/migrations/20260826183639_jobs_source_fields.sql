-- Phase 3: store non-core spreadsheet columns on jobs (not in job_description).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.jobs.source_fields IS
  'Extra spreadsheet columns from import (header → value). Not used for core job fields.';
