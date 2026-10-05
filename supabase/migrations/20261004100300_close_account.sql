-- Phase 7 migration 4: closing an account, and purging it 30 days later.
--
-- lib/billing/close-account.ts sets closed_at / purge_after (and bans the
-- logins). The daily cron /api/cron/purge-closed-accounts calls
-- purge_tenant() for businesses whose purge_after has passed. purge_tenant
-- is all-or-nothing: if any row still points at the business it raises, and
-- nothing is deleted.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS closed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS purge_after timestamp with time zone;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_purge_after_needs_closed;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_purge_after_needs_closed
  CHECK (purge_after IS NULL OR closed_at IS NOT NULL);

COMMENT ON COLUMN public.tenants.closed_at IS
  'Set when the owner closes the account (self-serve only). Logins are banned from then on.';
COMMENT ON COLUMN public.tenants.purge_after IS
  'When the daily cron may delete the business with purge_tenant(). Clear both columns (and unban) to restore.';

CREATE INDEX IF NOT EXISTS idx_tenants_purge_due
  ON public.tenants (purge_after)
  WHERE closed_at IS NOT NULL;

-- Lead texts of a business whose plan ended (or that closed) are skipped, not
-- sent later (step 18). Widen the Phase 6 skip reasons by one value.
ALTER TABLE public.lite_texts
  DROP CONSTRAINT IF EXISTS lite_texts_skip_reason_check;
ALTER TABLE public.lite_texts
  ADD CONSTRAINT lite_texts_skip_reason_check CHECK (skip_reason IS NULL OR skip_reason IN (
    'no_texts_left', 'opted_out', 'follow_ups_off', 'no_mobile', 'lead_closed', 'plan_ended'));

CREATE OR REPLACE FUNCTION public.purge_tenant(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
  v_ref record;
  v_pass integer := 0;
  v_rows bigint;
  v_progress boolean;
  v_stuck text[];
  v_counts jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'not_found');
  END IF;

  -- Guards: only closed, due, self-serve businesses with nothing live.
  IF v_tenant.closed_at IS NULL OR v_tenant.purge_after IS NULL OR v_tenant.purge_after > now() THEN
    RAISE EXCEPTION 'purge_tenant: % is not closed or not due yet', p_tenant_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE tenant_id = p_tenant_id
      AND (source = 'manual' OR product IN ('starter', 'growth', 'pro'))
  ) THEN
    RAISE EXCEPTION 'purge_tenant: % is a Pro or hand-set-up business; never purged automatically', p_tenant_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE tenant_id = p_tenant_id
      AND status IN ('trialing', 'active', 'past_due', 'manual')
  ) THEN
    RAISE EXCEPTION 'purge_tenant: % still has a live subscription', p_tenant_id;
  END IF;

  -- 1. Rows that point at a tenant-owned row but have no tenant column and
  --    no ON DELETE CASCADE (grandchildren). Cursor fills this list from the
  --    schema; see "Behaviour" 3. One DELETE per table, children first, e.g.:
  --    DELETE FROM public.<child> WHERE <parent_fk> IN (SELECT id FROM public.<parent> WHERE tenant_id = p_tenant_id);

  -- 2. Every public table whose foreign key to tenants has NO ACTION or
  --    RESTRICT. Repeated passes so the order works itself out; a table that
  --    can't be emptied yet (something still points at its rows) is retried
  --    on the next pass. CASCADE / SET NULL keys are left to step 3.
  LOOP
    v_pass := v_pass + 1;
    v_progress := false;
    v_stuck := '{}';

    FOR v_ref IN
      SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND c.confrelid = 'public.tenants'::regclass
        AND array_length(c.conkey, 1) = 1
        AND c.confdeltype IN ('a', 'r')
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE %I = $1', v_ref.tbl, v_ref.col) USING p_tenant_id;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows > 0 THEN
          v_progress := true;
          v_counts := v_counts || jsonb_build_object(
            v_ref.tbl::text,
            coalesce((v_counts ->> v_ref.tbl::text)::bigint, 0) + v_rows
          );
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        v_stuck := array_append(v_stuck, v_ref.tbl::text);
      END;
    END LOOP;

    EXIT WHEN cardinality(v_stuck) = 0;
    IF NOT v_progress OR v_pass >= 25 THEN
      RAISE EXCEPTION 'purge_tenant: % stuck on %', p_tenant_id, array_to_string(v_stuck, ', ');
    END IF;
  END LOOP;

  -- 3. The business itself; CASCADE keys delete the rest, SET NULL keys null.
  DELETE FROM public.tenants WHERE id = p_tenant_id;

  RETURN jsonb_build_object('purged', true, 'passes', v_pass, 'deleted', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_tenant(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.purge_tenant(uuid) IS
  'Deletes a closed, due, self-serve business and everything that belongs to it, all or nothing. Service role only (daily cron).';
