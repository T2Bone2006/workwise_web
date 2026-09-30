-- Phase 4 (Direct Debit), file 1 of 4. Paste after 20260929130000_customer_message_defaults,
-- before 20260930100100_owner_pushes.
--
-- customer_charges: "other amounts owed" (D12). Starting balance is kind
--   'starting_balance'. Paid off by the money engine exactly like a visit.
-- payment_allocations: may point at a charge instead of a visit.
-- recompute_customer_payments(): owed items = completed Rounds visits (not
--   waived) + active charges, ordered by date (charge first on the same date).
-- customer_balances: owed_amount includes charges; new last column
--   other_owed_amount.
--
-- Additive only. Idempotent. Pro customers never have charges (the app only
-- offers them on Rounds customers) and Pro jobs are still never touched.

-- ---------------------------------------------------------------------------
-- 1. customer_charges

CREATE TABLE IF NOT EXISTS public.customer_charges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'other',
  description text NOT NULL,
  amount numeric(10,2) NOT NULL,
  charge_date date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by_user_id uuid,
  voided_at timestamp with time zone,
  voided_by_user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT customer_charges_pkey PRIMARY KEY (id),
  CONSTRAINT customer_charges_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT customer_charges_customer_id_fkey FOREIGN KEY (customer_id)
    REFERENCES public.customers(id) ON DELETE CASCADE,
  CONSTRAINT customer_charges_created_by_fkey FOREIGN KEY (created_by_user_id)
    REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT customer_charges_voided_by_fkey FOREIGN KEY (voided_by_user_id)
    REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT customer_charges_kind_check CHECK (kind IN ('starting_balance', 'other')),
  CONSTRAINT customer_charges_status_check CHECK (status IN ('active', 'void')),
  CONSTRAINT customer_charges_amount_check CHECK (amount > 0 AND amount <= 100000),
  CONSTRAINT customer_charges_description_check CHECK (char_length(btrim(description)) BETWEEN 1 AND 120),
  CONSTRAINT customer_charges_void_consistency_check CHECK ((status = 'void') = (voided_at IS NOT NULL))
);

COMMENT ON TABLE public.customer_charges IS
  'Phase 4 (D12): other amounts a customer owes, e.g. owed from before WorkWise. Paid by recompute_customer_payments() like visits. Never deleted: undo = void.';

CREATE INDEX IF NOT EXISTS idx_customer_charges_customer
  ON public.customer_charges (customer_id, charge_date)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_customer_charges_tenant
  ON public.customer_charges (tenant_id);

DROP TRIGGER IF EXISTS customer_charges_set_updated_at ON public.customer_charges;
CREATE TRIGGER customer_charges_set_updated_at
  BEFORE UPDATE ON public.customer_charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customer_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_charges_tenant_select" ON public.customer_charges;
DROP POLICY IF EXISTS "customer_charges_admin_insert" ON public.customer_charges;
DROP POLICY IF EXISTS "customer_charges_admin_void" ON public.customer_charges;

CREATE POLICY "customer_charges_tenant_select"
ON public.customer_charges FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  OR tenant_id IN (SELECT primary_tenant_id FROM public.workers WHERE user_id = auth.uid())
);

CREATE POLICY "customer_charges_admin_insert"
ON public.customer_charges FOR INSERT TO authenticated
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
  AND status = 'active'
  AND customer_id IN (SELECT c.id FROM public.customers c WHERE c.tenant_id = customer_charges.tenant_id)
);

CREATE POLICY "customer_charges_admin_void"
ON public.customer_charges FOR UPDATE TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
  AND status = 'active'
)
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
  AND status = 'void'
);

REVOKE ALL ON public.customer_charges FROM anon, authenticated;
GRANT SELECT ON public.customer_charges TO authenticated;
GRANT INSERT (tenant_id, customer_id, kind, description, amount, charge_date, created_by_user_id)
  ON public.customer_charges TO authenticated;
GRANT UPDATE (status, voided_at, voided_by_user_id)
  ON public.customer_charges TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. payment_allocations: a visit OR a charge

ALTER TABLE public.payment_allocations ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE public.payment_allocations ADD COLUMN IF NOT EXISTS charge_id uuid;

ALTER TABLE public.payment_allocations DROP CONSTRAINT IF EXISTS payment_allocations_charge_id_fkey;
ALTER TABLE public.payment_allocations
  ADD CONSTRAINT payment_allocations_charge_id_fkey FOREIGN KEY (charge_id)
    REFERENCES public.customer_charges(id) ON DELETE CASCADE;

ALTER TABLE public.payment_allocations DROP CONSTRAINT IF EXISTS payment_allocations_one_target_check;
ALTER TABLE public.payment_allocations
  ADD CONSTRAINT payment_allocations_one_target_check CHECK (num_nonnulls(job_id, charge_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_allocations_payment_charge
  ON public.payment_allocations (payment_id, charge_id)
  WHERE charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_allocations_charge_id
  ON public.payment_allocations (charge_id)
  WHERE charge_id IS NOT NULL;

COMMENT ON COLUMN public.payment_allocations.charge_id IS
  'Phase 4: set when this slice of a payment paid an other-amount-owed (customer_charges) instead of a visit. Exactly one of job_id / charge_id.';

-- ---------------------------------------------------------------------------
-- 3. The engine: visits + charges

CREATE OR REPLACE FUNCTION public.recompute_customer_payments(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_pay record;
  v_item record;
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

    FOR v_item IN
      SELECT *
        FROM (
          SELECT 'job'::text AS kind,
                 j.id,
                 round(coalesce(j.final_amount, j.quoted_amount, 0), 2)
                   - coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.job_id = j.id), 0)
                   AS outstanding,
                 coalesce(j.scheduled_date, (j.completed_at AT TIME ZONE 'Europe/London')::date) AS item_date,
                 1 AS kind_order,
                 j.completed_at AS item_at,
                 coalesce(j.id = v_pay.applies_to_job_id, false) AS is_own,
                 coalesce(
                   v_pay.invoice_id IS NOT NULL
                   AND j.id IN (SELECT l.job_id FROM public.invoice_lines l WHERE l.invoice_id = v_pay.invoice_id),
                   false
                 ) AS on_invoice
            FROM public.jobs j
           WHERE j.customer_id = p_customer_id
             AND j.tenant_id = v_tenant
             AND j.status = 'completed'
             AND j.payment_status IS NOT NULL
             AND j.payment_status <> 'waived'
          UNION ALL
          SELECT 'charge'::text,
                 c.id,
                 c.amount
                   - coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.charge_id = c.id), 0),
                 c.charge_date,
                 0,
                 c.created_at,
                 false,
                 false
            FROM public.customer_charges c
           WHERE c.customer_id = p_customer_id
             AND c.tenant_id = v_tenant
             AND c.status = 'active'
        ) items
       ORDER BY items.is_own DESC, items.on_invoice DESC, items.item_date, items.kind_order, items.item_at, items.id
    LOOP
      EXIT WHEN v_left <= 0;
      CONTINUE WHEN v_item.outstanding <= 0;
      v_take := least(v_left, v_item.outstanding);
      IF v_item.kind = 'job' THEN
        INSERT INTO public.payment_allocations (tenant_id, payment_id, job_id, amount)
        VALUES (v_tenant, v_pay.id, v_item.id, v_take);
      ELSE
        INSERT INTO public.payment_allocations (tenant_id, payment_id, charge_id, amount)
        VALUES (v_tenant, v_pay.id, v_item.id, v_take);
      END IF;
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
             AND a.job_id IS NOT NULL
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

REVOKE ALL ON FUNCTION public.recompute_customer_payments(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_customer_payments(uuid) TO service_role;

-- Re-run the engine when a charge is added, voided or changed.
CREATE OR REPLACE FUNCTION public.customer_charges_recompute_trg()
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

DROP TRIGGER IF EXISTS customer_charges_recompute ON public.customer_charges;
CREATE TRIGGER customer_charges_recompute
  AFTER INSERT OR DELETE OR UPDATE OF status, amount, charge_date, customer_id
  ON public.customer_charges
  FOR EACH ROW EXECUTE FUNCTION public.customer_charges_recompute_trg();

-- ---------------------------------------------------------------------------
-- 4. customer_balances: charges included; new last column other_owed_amount

CREATE OR REPLACE VIEW public.customer_balances
WITH (security_invoker = true)
AS
SELECT
  c.id AS customer_id,
  c.tenant_id,
  (coalesce(o.owed, 0) + coalesce(ch.owed, 0))::numeric(10,2) AS owed_amount,
  coalesce(o.visits, 0)::integer AS unpaid_visit_count,
  least(o.oldest_date, ch.oldest_date) AS oldest_unpaid_date,
  greatest(coalesce(p.usable, 0) - coalesce(p.allocated, 0), 0)::numeric(10,2) AS credit_amount,
  coalesce(ch.owed, 0)::numeric(10,2) AS other_owed_amount
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
  SELECT sum(y.outstanding) AS owed,
         min(y.charge_date) AS oldest_date
    FROM (
      SELECT cc.amount
               - coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.charge_id = cc.id), 0)
               AS outstanding,
             cc.charge_date
        FROM public.customer_charges cc
       WHERE cc.customer_id = c.id
         AND cc.status = 'active'
    ) y
   WHERE y.outstanding > 0
) ch ON true
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
  'Per customer: owed_amount (completed visits not yet paid + other amounts owed), unpaid_visit_count (visits only), oldest_unpaid_date (visit or charge), credit_amount (money received not yet used), other_owed_amount (charges only). RLS of the caller applies.';

REVOKE ALL ON public.customer_balances FROM anon;
GRANT SELECT ON public.customer_balances TO authenticated;
