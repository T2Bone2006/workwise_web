-- Worker web area, migration 1: invite kind and the worker-price link.
--
-- 1. worker_invites.kind says whether an invite is a plain employee invite
--    (set a password, work for the employer) or a business invite (the
--    self-employed set-up that also creates the worker's own business).
--    Every existing invite is an employee invite.
-- 2. tenants.worker_discount_worker_id remembers which worker row (and so which
--    employer link) earns a worker-made business the 20% Lite price. It is a plain
--    uuid on purpose, with no foreign key: if the employer deletes the worker, the
--    id stays behind, the lookup finds no worker, and the daily check takes the
--    discount off. (A foreign key with SET NULL would forget the business was ever
--    a worker's, and a restrict would stop the employer deleting the worker.)
-- 3. tenants.worker_discount_ended_notified_at records that we have already
--    taken the discount off and told them (null = not ended / not told).
--
-- Additive and idempotent. No policy, grant or existing function changes.

ALTER TABLE public.worker_invites
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'employee';

ALTER TABLE public.worker_invites DROP CONSTRAINT IF EXISTS worker_invites_kind_check;
ALTER TABLE public.worker_invites
  ADD CONSTRAINT worker_invites_kind_check CHECK (kind IN ('employee', 'business'));

COMMENT ON COLUMN public.worker_invites.kind IS
  'employee = plain invite (set a password, work for the employer). business = self-employed set-up: also creates the worker''s own business.';

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS worker_discount_worker_id uuid;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS worker_discount_ended_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS tenants_worker_discount_worker_idx
  ON public.tenants (worker_discount_worker_id)
  WHERE worker_discount_worker_id IS NOT NULL;

COMMENT ON COLUMN public.tenants.worker_discount_worker_id IS
  'Set when a self-employed worker made this business from an employer''s invite. While that workers row exists, is not deactivated and its employer has a live Pro plan, Lite is 20% off. Deliberately not a foreign key.';

COMMENT ON COLUMN public.tenants.worker_discount_ended_notified_at IS
  'When the worker price was taken off and the owner told. Null = still on, or never had it.';
