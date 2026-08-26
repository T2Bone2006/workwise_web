-- Phase 5: searchable text of source_fields for jobs list global search.
-- PostgREST cannot ilike a jsonb root; generated text covers keys + values.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS source_fields_text text
  GENERATED ALWAYS AS (source_fields::text) STORED;
