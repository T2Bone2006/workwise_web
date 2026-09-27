-- Phase 2 (payments), file 4 of 4. Paste last.
--
-- The money engine. For one customer, recompute_customer_payments():
--   1. locks the customer row (two payments arriving together queue up),
--   2. deletes that customer's allocations,
--   3. walks active payments oldest first; each pays (a) its own visit
--      (applies_to_job_id), then (b) its invoice's visits, then (c) the
--      oldest outstanding completed visit,
--   4. rewrites jobs.payment_status for the customer's Rounds visits.
-- Whatever a payment cannot place stays unallocated: that is the customer's
-- credit, and it is used automatically the next time a visit is completed
-- (the jobs trigger below re-runs the engine).
--
-- Only Rounds visits are touched: rows with payment_status IS NOT NULL.
-- Pro jobs have payment_status NULL and are never read or written here.
--
-- jobs.payment_status is guarded: any UPDATE that changes it outside the
-- engine is silently reverted (the live policy "Workers can update their own
-- assigned jobs" would otherwise let the phone mark a visit paid with no
-- payment behind it). The engine and set_visit_waived() open the guard with
-- a transaction-local setting.

-- ---------------------------------------------------------------------------
-- Guard

CREATE OR REPLACE FUNCTION public.jobs_guard_payment_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND coalesce(current_setting('workwise.payment_write', true), '') <> 'on' THEN
    NEW.payment_status := OLD.payment_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_guard_payment_status ON public.jobs;
CREATE TRIGGER jobs_guard_payment_status
  BEFORE UPDATE OF payment_status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_guard_payment_status();

-- ---------------------------------------------------------------------------
-- Engine

CREATE OR REPLACE FUNCTION public.recompute_customer_payments(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_pay record;
  v_job record;
  v_left numeric(10,2);
  v_take numeric(10,2);
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  SELECT tenant_id INTO v_tenant
    FROM public.customers
   WHERE id = p_customer_id
     FOR UPDATE;
  IF NOT FOUND OR v_tenant IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('workwise.payment_write', 'on', true);

  DELETE FROM public.payment_allocations pa
   USING public.payments p
   WHERE pa.payment_id = p.id
     AND p.customer_id = p_customer_id;

  FOR v_pay IN
    SELECT p.id,
           (p.amount - p.refunded_amount) AS usable,
           p.applies_to_job_id,
           p.invoice_id
      FROM public.payments p
     WHERE p.customer_id = p_customer_id
       AND p.status = 'active'
       AND p.amount - p.refunded_amount > 0
     ORDER BY p.received_at, p.created_at, p.id
  LOOP
    v_left := v_pay.usable;

    FOR v_job IN
      SELECT j.id,
             round(coalesce(j.final_amount, j.quoted_amount, 0), 2)
               - coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.job_id = j.id), 0)
               AS outstanding
        FROM public.jobs j
       WHERE j.customer_id = p_customer_id
         AND j.tenant_id = v_tenant
         AND j.status = 'completed'
         AND j.payment_status IS NOT NULL
         AND j.payment_status <> 'waived'
       ORDER BY
         coalesce(j.id = v_pay.applies_to_job_id, false) DESC,
         coalesce(
           v_pay.invoice_id IS NOT NULL
           AND j.id IN (SELECT l.job_id FROM public.invoice_lines l WHERE l.invoice_id = v_pay.invoice_id),
           false
         ) DESC,
         coalesce(j.scheduled_date, (j.completed_at AT TIME ZONE 'Europe/London')::date),
         j.completed_at,
         j.id
    LOOP
      EXIT WHEN v_left <= 0;
      CONTINUE WHEN v_job.outstanding <= 0;
      v_take := least(v_left, v_job.outstanding);
      INSERT INTO public.payment_allocations (tenant_id, payment_id, job_id, amount)
      VALUES (v_tenant, v_pay.id, v_job.id, v_take);
      v_left := v_left - v_take;
    END LOOP;
  END LOOP;

  UPDATE public.jobs j
     SET payment_status = s.new_status
    FROM (
      SELECT j2.id,
             CASE
               WHEN j2.status <> 'completed' THEN 'unpaid'
               WHEN round(coalesce(j2.final_amount, j2.quoted_amount, 0), 2) <= coalesce(al.total, 0) THEN 'paid'
               WHEN coalesce(al.total, 0) > 0 THEN 'partial'
               ELSE 'unpaid'
             END AS new_status
        FROM public.jobs j2
        LEFT JOIN (
          SELECT a.job_id, sum(a.amount) AS total
            FROM public.payment_allocations a
            JOIN public.payments p ON p.id = a.payment_id
           WHERE p.customer_id = p_customer_id
           GROUP BY a.job_id
        ) al ON al.job_id = j2.id
       WHERE j2.customer_id = p_customer_id
         AND j2.tenant_id = v_tenant
         AND j2.payment_status IS NOT NULL
         AND j2.payment_status <> 'waived'
    ) s
   WHERE j.id = s.id
     AND j.payment_status IS DISTINCT FROM s.new_status;

  PERFORM set_config('workwise.payment_write', 'off', true);
END;
$$;

-- Only triggers (running as the function owner) and the service role call it.
REVOKE ALL ON FUNCTION public.recompute_customer_payments(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_customer_payments(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Triggers that run the engine

CREATE OR REPLACE FUNCTION public.payments_recompute_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.recompute_customer_payments(NEW.customer_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id) THEN
    PERFORM public.recompute_customer_payments(OLD.customer_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS payments_recompute ON public.payments;
CREATE TRIGGER payments_recompute
  AFTER INSERT OR DELETE OR UPDATE OF status, amount, refunded_amount, applies_to_job_id, invoice_id, customer_id
  ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_recompute_trg();

CREATE OR REPLACE FUNCTION public.jobs_recompute_payments_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_customer_payments(NEW.customer_id);
  IF OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
    PERFORM public.recompute_customer_payments(OLD.customer_id);
  END IF;
  RETURN NULL;
END;
$$;

-- Fires when a Rounds visit becomes / stops being completed, or a completed
-- visit's price changes. A payment_status-only update (the engine's own
-- write) does not match, so the engine never re-triggers itself.
DROP TRIGGER IF EXISTS jobs_recompute_payments ON public.jobs;
CREATE TRIGGER jobs_recompute_payments
  AFTER UPDATE OF status, final_amount, quoted_amount, customer_id ON public.jobs
  FOR EACH ROW
  WHEN (
    NEW.payment_status IS NOT NULL
    AND NEW.customer_id IS NOT NULL
    AND (OLD.status = 'completed' OR NEW.status = 'completed')
    AND (
      OLD.status IS DISTINCT FROM NEW.status
      OR OLD.final_amount IS DISTINCT FROM NEW.final_amount
      OR OLD.quoted_amount IS DISTINCT FROM NEW.quoted_amount
      OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
    )
  )
  EXECUTE FUNCTION public.jobs_recompute_payments_trg();

-- ---------------------------------------------------------------------------
-- Waive ("let them off this one") and un-waive.

CREATE OR REPLACE FUNCTION public.set_visit_waived(p_job_id uuid, p_waived boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job record;
BEGIN
  SELECT id, tenant_id, customer_id, status, payment_status
    INTO v_job
    FROM public.jobs
   WHERE id = p_job_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visit not found' USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(auth.role(), 'none') NOT IN ('service_role', 'none') AND NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = auth.uid() AND tenant_id = v_job.tenant_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF v_job.payment_status IS NULL THEN
    RAISE EXCEPTION 'Not a Rounds visit' USING ERRCODE = '22023';
  END IF;
  IF p_waived AND v_job.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a completed visit can be waived' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('workwise.payment_write', 'on', true);
  UPDATE public.jobs
     SET payment_status = CASE WHEN p_waived THEN 'waived' ELSE 'unpaid' END
   WHERE id = p_job_id;
  PERFORM set_config('workwise.payment_write', 'off', true);

  PERFORM public.recompute_customer_payments(v_job.customer_id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_visit_waived(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_visit_waived(uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- customer_balances: owed and credit per customer, read with the caller's
-- own RLS (security_invoker), so it never shows another business's numbers.

CREATE OR REPLACE VIEW public.customer_balances
WITH (security_invoker = true)
AS
SELECT
  c.id AS customer_id,
  c.tenant_id,
  coalesce(o.owed, 0)::numeric(10,2) AS owed_amount,
  coalesce(o.visits, 0)::integer AS unpaid_visit_count,
  o.oldest_date AS oldest_unpaid_date,
  greatest(coalesce(p.usable, 0) - coalesce(p.allocated, 0), 0)::numeric(10,2) AS credit_amount
FROM public.customers c
LEFT JOIN LATERAL (
  SELECT sum(x.outstanding) AS owed,
         count(*) AS visits,
         min(x.visit_date) AS oldest_date
    FROM (
      SELECT round(coalesce(j.final_amount, j.quoted_amount, 0), 2)
               - coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.job_id = j.id), 0)
               AS outstanding,
             coalesce(j.scheduled_date, (j.completed_at AT TIME ZONE 'Europe/London')::date) AS visit_date
        FROM public.jobs j
       WHERE j.customer_id = c.id
         AND j.status = 'completed'
         AND j.payment_status IN ('unpaid', 'partial')
    ) x
   WHERE x.outstanding > 0
) o ON true
LEFT JOIN LATERAL (
  SELECT sum(py.amount - py.refunded_amount) AS usable,
         (SELECT coalesce(sum(a.amount), 0)
            FROM public.payment_allocations a
            JOIN public.payments p2 ON p2.id = a.payment_id
           WHERE p2.customer_id = c.id AND p2.status = 'active') AS allocated
    FROM public.payments py
   WHERE py.customer_id = c.id
     AND py.status = 'active'
) p ON true;

COMMENT ON VIEW public.customer_balances IS
  'Per customer: owed_amount (completed visits not yet paid), unpaid_visit_count, oldest_unpaid_date, credit_amount (money received not yet used). RLS of the caller applies.';

REVOKE ALL ON public.customer_balances FROM anon;
GRANT SELECT ON public.customer_balances TO authenticated;
