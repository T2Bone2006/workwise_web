-- Rounds columns on jobs. A visit is a job; these columns tie it back to the
-- agreement that generated it and carry the day-run state the Pro product
-- never needed.
--
-- The UNIQUE constraint is what makes generation idempotent: generate-visits
-- upserts on (service_agreement_id, agreement_occurrence_date) with
-- ignoreDuplicates, so a cron re-run or a webhook retry cannot double-book a
-- day. It is deliberately NOT partial: PostgREST needs a plain unique
-- constraint to resolve on_conflict, and NULLs are distinct so non-agreement
-- jobs are unaffected.
--
-- payment_status is written as 'unpaid' at generation; the trigger that
-- recomputes it from payment_allocations arrives with Phase 2's payments
-- migration.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS service_agreement_id uuid,
  ADD COLUMN IF NOT EXISTS agreement_occurrence_date date,
  -- 1-based order within the day after "Optimise" or a manual reorder. NULL = unordered.
  ADD COLUMN IF NOT EXISTS route_position integer,
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS customer_confirmation_status text;

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_service_agreement_id_fkey;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_service_agreement_id_fkey FOREIGN KEY (service_agreement_id)
    REFERENCES public.service_agreements(id) ON DELETE SET NULL;

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_skip_reason_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_skip_reason_check CHECK (
    skip_reason IS NULL OR skip_reason IN (
      'no_access', 'weather', 'customer_declined', 'customer_away',
      'agreement_paused', 'agreement_ended', 'other'
    )
  );

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_payment_status_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_payment_status_check CHECK (
    payment_status IS NULL OR payment_status IN ('unpaid', 'partial', 'paid', 'waived', 'invoiced')
  );

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_customer_confirmation_status_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_customer_confirmation_status_check CHECK (
    customer_confirmation_status IS NULL
    OR customer_confirmation_status IN ('pending', 'confirmed', 'declined', 'rescheduled')
  );

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_agreement_occurrence_key;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_agreement_occurrence_key
    UNIQUE (service_agreement_id, agreement_occurrence_date);

CREATE INDEX IF NOT EXISTS idx_jobs_service_agreement_id
  ON public.jobs (service_agreement_id)
  WHERE service_agreement_id IS NOT NULL;

-- Day and month views read one tenant's jobs by date.
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_scheduled_date
  ON public.jobs (tenant_id, scheduled_date);

COMMENT ON COLUMN public.jobs.agreement_occurrence_date IS
  'Nominal date from the agreement cycle. scheduled_date is where the visit actually landed after weekday/working-day/blackout shifts.';
COMMENT ON COLUMN public.jobs.skip_reason IS
  'Set with status = cancelled for a skipped Rounds visit.';
