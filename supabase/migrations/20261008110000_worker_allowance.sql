-- Pro worker allowance.
--
-- 1. subscriptions.included_workers_override: a custom "workers included" for one
--    business (e.g. a deal of 15 on Starter). Null = the tier's default
--    (Starter 10, Growth 35, Pro 70). Ignored for manual subscriptions, which are
--    never limited. Set by hand:
--      UPDATE public.subscriptions SET included_workers_override = 15
--      WHERE tenant_id = '<tenant id>' AND product = 'starter'
--        AND status IN ('trialing','active','past_due');
--
-- 2. worker_allowance_confirmations: a record that the account holder agreed to
--    the extra-worker price before adding a worker past the allowance. Written
--    only by the service role (no policies), so nobody can edit their own trail.
--
-- Safe to run twice. The dashboard works before this runs: it reads the override
-- column only if it exists and logs (does not fail) if the table is missing.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS included_workers_override integer;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_included_workers_override_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_included_workers_override_check
  CHECK (included_workers_override IS NULL OR included_workers_override >= 0);

COMMENT ON COLUMN public.subscriptions.included_workers_override IS
  'Custom number of workers included for this business. Null = the tier default. Ignored when source = manual.';

CREATE TABLE IF NOT EXISTS public.worker_allowance_confirmations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  confirmed_by_user_id uuid,
  worker_id uuid,
  tier text NOT NULL,
  worker_number integer NOT NULL,
  included_workers integer NOT NULL,
  extra_worker_pounds numeric NOT NULL,
  confirmed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT worker_allowance_confirmations_pkey PRIMARY KEY (id),
  CONSTRAINT worker_allowance_confirmations_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT worker_allowance_confirmations_user_fkey
    FOREIGN KEY (confirmed_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT worker_allowance_confirmations_worker_fkey
    FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_worker_allowance_confirmations_tenant
  ON public.worker_allowance_confirmations (tenant_id, confirmed_at DESC);

ALTER TABLE public.worker_allowance_confirmations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.worker_allowance_confirmations IS
  'Each time an account holder agreed to the extra-worker price. Service role only.';
