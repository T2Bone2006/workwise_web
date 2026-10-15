-- Phase 8 migration 3: purge_tenant() may now delete a closed, due, STRIPE-BILLED Pro business.
--
-- It still refuses any hand-set-up business (a manual row anywhere) and any Pro row that is not Stripe-billed,
-- so RS Locksmiths and Eden can never be purged. Everything else is as in 20261004100300_close_account.sql
-- except step 1, which now deletes the three grandchild tables (job_attachments, job_status_history,
-- customer_portal_users: they point at jobs, workers or customers but have no tenant column, and would block
-- the deletes in step 2). Safe to paste twice (CREATE OR REPLACE, nothing else).

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

  -- Guards: only closed, due, self-serve (Rounds, Lite or Stripe-billed Pro) businesses with nothing live.
  IF v_tenant.closed_at IS NULL OR v_tenant.purge_after IS NULL OR v_tenant.purge_after > now() THEN
    RAISE EXCEPTION 'purge_tenant: % is not closed or not due yet', p_tenant_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE tenant_id = p_tenant_id AND source = 'manual'
  ) THEN
    RAISE EXCEPTION 'purge_tenant: % is a hand-set-up business; never purged automatically', p_tenant_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE tenant_id = p_tenant_id
      AND product IN ('starter', 'growth', 'pro')
      AND source IS DISTINCT FROM 'stripe'
  ) THEN
    RAISE EXCEPTION 'purge_tenant: % has a Pro row that is not Stripe-billed; never purged automatically', p_tenant_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE tenant_id = p_tenant_id
      AND status IN ('trialing', 'active', 'past_due', 'manual')
  ) THEN
    RAISE EXCEPTION 'purge_tenant: % still has a live subscription', p_tenant_id;
  END IF;

  -- 1. Grandchildren: rows that point at a tenant-owned row but have no tenant column and no ON DELETE
  --    CASCADE (derived from the schema and every migration; each table with a tenant column has its own
  --    foreign key to tenants, so step 2 empties those). Without these, deleting the jobs, workers or customers
  --    in step 2 would be blocked and the whole purge would roll back.
  DELETE FROM public.job_attachments
   WHERE job_id IN (SELECT id FROM public.jobs WHERE tenant_id = p_tenant_id)
      OR uploaded_by_worker_id IN (SELECT id FROM public.workers WHERE primary_tenant_id = p_tenant_id);
  DELETE FROM public.job_status_history
   WHERE job_id IN (SELECT id FROM public.jobs WHERE tenant_id = p_tenant_id)
      OR changed_by_worker_id IN (SELECT id FROM public.workers WHERE primary_tenant_id = p_tenant_id);
  DELETE FROM public.customer_portal_users
   WHERE customer_id IN (SELECT id FROM public.customers WHERE tenant_id = p_tenant_id);

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
  'Deletes a closed, due, self-serve (Rounds, Lite or Stripe-billed Pro) business and everything that belongs to it, all or nothing. Never a manual business. Service role only (daily cron).';
