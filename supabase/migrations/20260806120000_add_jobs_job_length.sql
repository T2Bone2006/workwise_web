-- Universal job length (half day / full day), set at scheduling time via manual
-- creation or CSV import. Nullable: unknown/unset is a valid state, never guessed.
-- Same treatment as jobs.priority (fixed vocabulary, first-class column, not jsonb).
ALTER TABLE public.jobs
  ADD COLUMN job_length text NULL,
  ADD CONSTRAINT jobs_job_length_check CHECK (job_length IN ('half_day', 'full_day'));
