-- Add end_time to pair with the existing scheduled_time (start).
-- Both optional: unknown/unset is a valid state, never guessed.
-- job_length (half_day/full_day) stays as the coarse fallback for
-- customers who never give exact times — this does not replace it.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS end_time time without time zone NULL;

COMMENT ON COLUMN public.jobs.end_time IS
  'Optional scheduled finish time, paired with scheduled_time (start). Set at scheduling time via manual creation or CSV/AI import.';
