-- Phase 9 (Rounds team), file 2 of 3. Paste after 20261011100000_rounds_team.sql.
-- Spec: docs/specs/phase-9/04-migration-cash-held.md
--
-- Cash and cheques a member of staff collects are "held" by them until the owner ticks them as handed over.
-- The customer is treated as paid straight away (the money engine, the visit's payment_status and the
-- thank-you are untouched); only the OWNER'S books wait for the hand-in.
--
--   held  =  (collected_by_worker_id IS NOT NULL OR collected_by_name IS NOT NULL) AND handed_over_at IS NULL
--
-- collected_by_name keeps the collector's name at the time, so a payment stays "held" even if their workers
-- row is later deleted (collected_by_worker_id would then be set to NULL by its foreign key).
--
-- Nothing here touches recompute_customer_payments, its triggers, payments.received_at or any existing row:
-- every existing payment has the four new columns NULL, so it is not held.
--
-- To undo (history only; this is not run by the app):
--   DROP FUNCTION IF EXISTS public.unmark_payment_handed_over(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.mark_worker_cash_handed_over(uuid, uuid, uuid, timestamptz);
--   DROP FUNCTION IF EXISTS public.mark_payments_handed_over(uuid, uuid[], uuid, timestamptz);
--   ALTER TABLE public.payments DROP COLUMN IF EXISTS collected_by_worker_id, DROP COLUMN IF EXISTS collected_by_name,
--     DROP COLUMN IF EXISTS handed_over_at, DROP COLUMN IF EXISTS handed_over_by_user_id;

BEGIN;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS collected_by_worker_id uuid;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS collected_by_name text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS handed_over_at timestamptz;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS handed_over_by_user_id uuid;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_collected_by_fkey;
ALTER TABLE public.payments ADD CONSTRAINT payments_collected_by_fkey
  FOREIGN KEY (collected_by_worker_id) REFERENCES public.workers(id) ON DELETE SET NULL;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_handed_over_by_fkey;
ALTER TABLE public.payments ADD CONSTRAINT payments_handed_over_by_fkey
  FOREIGN KEY (handed_over_by_user_id) REFERENCES public.users(id);

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_collected_name_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_collected_name_check
  CHECK (collected_by_name IS NULL OR char_length(collected_by_name) <= 80);

-- Only cash and cheque can be held by a person.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_held_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_held_method_check
  CHECK ((collected_by_worker_id IS NULL AND collected_by_name IS NULL) OR method IN ('cash', 'cheque'));

-- Handed over only makes sense for a payment someone collected.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_handed_over_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_handed_over_check
  CHECK (handed_over_at IS NULL OR collected_by_worker_id IS NOT NULL OR collected_by_name IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_payments_held
  ON public.payments (tenant_id, collected_by_worker_id)
  WHERE (collected_by_worker_id IS NOT NULL OR collected_by_name IS NOT NULL)
    AND handed_over_at IS NULL
    AND status = 'active';

COMMENT ON COLUMN public.payments.collected_by_worker_id IS
  'Phase 9: the member of staff who took this cash/cheque. NULL for every payment the owner (or a card, bank or Direct Debit) took.';
COMMENT ON COLUMN public.payments.handed_over_at IS
  'Phase 9: when the owner ticked this held cash as handed over. The owner''s books count the payment from this moment, not from received_at.';

-- The owner is nudged about cash held for a few days (step 19): one more push kind.
ALTER TABLE public.owner_pushes DROP CONSTRAINT IF EXISTS owner_pushes_kind_check;
ALTER TABLE public.owner_pushes ADD CONSTRAINT owner_pushes_kind_check CHECK (kind IN (
  'card_payment', 'dd_payment', 'dd_failed', 'dd_cancelled', 'dd_active', 'dd_attention', 'cash_handin'
));

-- ---------------------------------------------------------------------------
-- Ticking cash as handed over (service role only; the app checks the caller is the owner first)

CREATE OR REPLACE FUNCTION public.mark_payments_handed_over(
  p_tenant_id uuid,
  p_payment_ids uuid[],
  p_user_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed integer;
BEGIN
  WITH done AS (
    UPDATE public.payments
    SET handed_over_at = p_at, handed_over_by_user_id = p_user_id
    WHERE tenant_id = p_tenant_id
      AND id = ANY (p_payment_ids)
      AND status = 'active'
      AND handed_over_at IS NULL
      AND (collected_by_worker_id IS NOT NULL OR collected_by_name IS NOT NULL)
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_changed FROM done;
  RETURN v_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_worker_cash_handed_over(
  p_tenant_id uuid,
  p_worker_id uuid,
  p_user_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed integer;
BEGIN
  WITH done AS (
    UPDATE public.payments
    SET handed_over_at = p_at, handed_over_by_user_id = p_user_id
    WHERE tenant_id = p_tenant_id
      AND collected_by_worker_id = p_worker_id
      AND status = 'active'
      AND handed_over_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_changed FROM done;
  RETURN v_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.unmark_payment_handed_over(
  p_tenant_id uuid,
  p_payment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.payments
  SET handed_over_at = NULL, handed_over_by_user_id = NULL
  WHERE id = p_payment_id
    AND tenant_id = p_tenant_id
    AND handed_over_at IS NOT NULL
    AND (collected_by_worker_id IS NOT NULL OR collected_by_name IS NOT NULL);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_payments_handed_over(uuid, uuid[], uuid, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payments_handed_over(uuid, uuid[], uuid, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.mark_worker_cash_handed_over(uuid, uuid, uuid, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_worker_cash_handed_over(uuid, uuid, uuid, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.unmark_payment_handed_over(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unmark_payment_handed_over(uuid, uuid) TO service_role;

COMMIT;

-- Checks (run after pasting; each should return what the comment says):
-- 1. The four new columns exist → 4 rows
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'payments'
--    AND column_name IN ('collected_by_worker_id','collected_by_name','handed_over_at','handed_over_by_user_id');
-- 2. Nothing existing is held → 0
-- SELECT count(*) FROM public.payments
--  WHERE collected_by_worker_id IS NOT NULL OR collected_by_name IS NOT NULL OR handed_over_at IS NOT NULL;
-- 3. The three new check constraints exist → 3 rows
-- SELECT conname FROM pg_constraint
--  WHERE conrelid = 'public.payments'::regclass
--    AND conname IN ('payments_collected_name_check','payments_held_method_check','payments_handed_over_check');
-- 4. The new push kind is allowed → 1 row
-- SELECT conname FROM pg_constraint WHERE conname = 'owner_pushes_kind_check' AND pg_get_constraintdef(oid) LIKE '%cash_handin%';
-- 5. The three functions exist and only the service role can run them → 3 rows, grantee service_role
-- SELECT routine_name, grantee FROM information_schema.routine_privileges
--  WHERE routine_name IN ('mark_payments_handed_over','mark_worker_cash_handed_over','unmark_payment_handed_over')
--    AND grantee IN ('authenticated','anon','service_role');
