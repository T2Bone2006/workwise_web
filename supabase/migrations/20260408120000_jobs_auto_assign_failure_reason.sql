-- Last auto-assign error message (dashboard), cleared on successful assign.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS auto_assign_failure_reason text;

COMMENT ON COLUMN public.jobs.auto_assign_failure_reason IS 'Set when auto-assign fails; cleared when a worker is assigned.';
