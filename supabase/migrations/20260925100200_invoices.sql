-- Phase 2 (payments), file 3 of 4. Paste after 20260925100100, before 20260925100300.
--
-- invoices + invoice_lines: an issued invoice is immutable. Seller details,
-- bill-to details, bank details, VAT and every line are copied in at issue
-- time, so editing the business address or a visit price later never changes
-- an invoice already sent. The PDF is rendered from these rows on demand.
--
-- create_invoice(): the ONLY way to create an invoice. Takes the next number
-- and writes the invoice and its lines in one transaction, so numbers are
-- unique, sequential per business, and never burned by a half-written
-- invoice.
--
-- Paid/unpaid is not stored on the invoice: it is read live from its visits'
-- payment_status (all paid → paid). status is only issued | void.

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  number text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'issued',
  issue_date date NOT NULL,
  due_date date NOT NULL,
  -- Seller snapshot
  seller_name text NOT NULL,
  seller_address text,
  seller_phone text,
  seller_email text,
  seller_logo_url text,
  seller_vat_number text,
  -- Bill-to snapshot
  bill_to_name text NOT NULL,
  bill_to_company text,
  bill_to_address text,
  bill_to_email text,
  -- How to pay snapshot
  bank_account_name text,
  bank_sort_code text,
  bank_account_number text,
  payment_reference text,
  -- Money. vat_rate_percent NULL = not VAT registered.
  vat_rate_percent numeric(5,2),
  subtotal_net numeric(10,2) NOT NULL,
  vat_amount numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL,
  amount_paid_at_issue numeric(10,2) NOT NULL DEFAULT 0,
  footer text,
  -- Random token for https://<app>/pay/i/<token>.
  public_token text NOT NULL,
  sent_at timestamp with time zone,
  sent_to_email text,
  voided_at timestamp with time zone,
  void_reason text,
  created_by_user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT invoices_pkey PRIMARY KEY (id),
  CONSTRAINT invoices_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id)
    REFERENCES public.customers(id) ON DELETE CASCADE,
  CONSTRAINT invoices_created_by_user_id_fkey FOREIGN KEY (created_by_user_id)
    REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT invoices_tenant_number_key UNIQUE (tenant_id, number),
  CONSTRAINT invoices_public_token_key UNIQUE (public_token),
  CONSTRAINT invoices_kind_check CHECK (kind IN ('visit', 'balance')),
  CONSTRAINT invoices_status_check CHECK (status IN ('issued', 'void')),
  CONSTRAINT invoices_void_consistency_check CHECK ((status = 'void') = (voided_at IS NOT NULL)),
  CONSTRAINT invoices_void_reason_check CHECK (void_reason IS NULL OR char_length(void_reason) <= 300),
  CONSTRAINT invoices_total_check CHECK (total >= 0 AND subtotal_net >= 0 AND vat_amount >= 0)
);

COMMENT ON TABLE public.invoices IS
  'Issued invoices. Immutable snapshot; created only by create_invoice(). Paid state is derived from the lines'' visits.';

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_issue
  ON public.invoices (tenant_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_customer
  ON public.invoices (customer_id, issue_date DESC);

DROP TRIGGER IF EXISTS invoices_set_updated_at ON public.invoices;
CREATE TRIGGER invoices_set_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.invoice_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  job_id uuid,
  service_date date,
  description text NOT NULL,
  address text,
  amount numeric(10,2) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT invoice_lines_pkey PRIMARY KEY (id),
  CONSTRAINT invoice_lines_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id)
    REFERENCES public.invoices(id) ON DELETE CASCADE,
  CONSTRAINT invoice_lines_job_id_fkey FOREIGN KEY (job_id)
    REFERENCES public.jobs(id) ON DELETE SET NULL,
  CONSTRAINT invoice_lines_amount_check CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON public.invoice_lines (invoice_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_job ON public.invoice_lines (job_id) WHERE job_id IS NOT NULL;

-- payments.invoice_id → invoices (column created in file 2).
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_invoice_id_fkey;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id)
    REFERENCES public.invoices(id) ON DELETE SET NULL;

-- RLS: any login of the tenant may read. Clients never INSERT (only
-- create_invoice) and may UPDATE only the send/void columns.
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_tenant_select" ON public.invoices;
DROP POLICY IF EXISTS "invoices_admin_update" ON public.invoices;
DROP POLICY IF EXISTS "invoice_lines_tenant_select" ON public.invoice_lines;

CREATE POLICY "invoices_tenant_select"
ON public.invoices FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  OR tenant_id IN (SELECT primary_tenant_id FROM public.workers WHERE user_id = auth.uid())
);

CREATE POLICY "invoices_admin_update"
ON public.invoices FOR UPDATE
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "invoice_lines_tenant_select"
ON public.invoice_lines FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  OR tenant_id IN (SELECT primary_tenant_id FROM public.workers WHERE user_id = auth.uid())
);

REVOKE ALL ON public.invoices FROM anon;
REVOKE ALL ON public.invoice_lines FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.invoices FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.invoice_lines FROM authenticated;
GRANT SELECT ON public.invoices TO authenticated;
GRANT SELECT ON public.invoice_lines TO authenticated;
GRANT UPDATE (sent_at, sent_to_email, status, voided_at, void_reason)
  ON public.invoices TO authenticated;

-- ---------------------------------------------------------------------------
-- create_invoice(customer, visits, kind) → invoice id
--
-- Caller: a logged-in admin of the customer's business (dashboard action or
-- phone bearer API), or the service role. Lines are the given visits that
-- are completed, belong to this customer, and are Rounds visits
-- (payment_status set) and not waived. Line amount = the visit's full price;
-- amount_paid_at_issue = what was already allocated to those visits, so the
-- PDF can show "Paid" and "Balance due".
--
-- VAT is inclusive (prices are what the customer pays):
--   net = round(total / (1 + rate/100), 2), vat = total - net.

CREATE OR REPLACE FUNCTION public.create_invoice(
  p_customer_id uuid,
  p_job_ids uuid[],
  p_kind text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
  v_settings public.tenant_payment_settings%ROWTYPE;
  v_seq integer;
  v_number text;
  v_issue date := (now() AT TIME ZONE 'Europe/London')::date;
  v_invoice_id uuid;
  v_total numeric(10,2);
  v_paid numeric(10,2);
  v_net numeric(10,2);
  v_vat numeric(10,2);
  v_rate numeric(5,2);
  v_bill_address text;
  v_lines integer;
BEGIN
  IF p_kind NOT IN ('visit', 'balance') THEN
    RAISE EXCEPTION 'Invalid invoice kind %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_job_ids IS NULL OR array_length(p_job_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Nothing to invoice' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id;
  IF NOT FOUND OR v_customer.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE = 'P0002';
  END IF;

  -- Allowed: an admin of this business, the service role, or a direct
  -- database session with no JWT at all (the owner in the SQL editor).
  -- anon can never reach this line: EXECUTE is not granted to anon.
  IF coalesce(auth.role(), 'none') NOT IN ('service_role', 'none') AND NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = auth.uid() AND tenant_id = v_customer.tenant_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_customer.tenant_id;

  -- Make sure the settings row exists, then take the next number. The row
  -- lock taken by UPDATE serialises two invoices created at the same moment.
  INSERT INTO public.tenant_payment_settings (tenant_id)
  VALUES (v_customer.tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.tenant_payment_settings
     SET next_invoice_seq = next_invoice_seq + 1
   WHERE tenant_id = v_customer.tenant_id
  RETURNING next_invoice_seq - 1 INTO v_seq;

  SELECT * INTO v_settings FROM public.tenant_payment_settings WHERE tenant_id = v_customer.tenant_id;
  v_number := v_settings.invoice_prefix || '-' || lpad(v_seq::text, 4, '0');

  -- Bill-to address: billing address, else the first active agreement's address.
  v_bill_address := nullif(btrim(coalesce(v_customer.billing_address, '')), '');
  IF v_bill_address IS NULL THEN
    SELECT a.address || coalesce(', ' || a.postcode, '')
      INTO v_bill_address
      FROM public.service_agreements a
     WHERE a.customer_id = v_customer.id AND a.status <> 'ended'
     ORDER BY a.created_at
     LIMIT 1;
  END IF;

  v_invoice_id := gen_random_uuid();

  INSERT INTO public.invoices (
    id, tenant_id, customer_id, number, kind, status, issue_date, due_date,
    seller_name, seller_address, seller_phone, seller_email, seller_logo_url, seller_vat_number,
    bill_to_name, bill_to_company, bill_to_address, bill_to_email,
    bank_account_name, bank_sort_code, bank_account_number, payment_reference,
    vat_rate_percent, subtotal_net, vat_amount, total, amount_paid_at_issue,
    footer, public_token, created_by_user_id
  ) VALUES (
    v_invoice_id, v_customer.tenant_id, v_customer.id, v_number, p_kind, 'issued',
    v_issue, v_issue + v_settings.invoice_due_days,
    v_tenant.name,
    nullif(btrim(coalesce(v_tenant.settings -> 'company' ->> 'address', '')), ''),
    nullif(btrim(coalesce(v_tenant.settings -> 'company' ->> 'phone', '')), ''),
    nullif(btrim(coalesce(v_tenant.settings -> 'company' ->> 'email', '')), ''),
    nullif(btrim(coalesce(v_tenant.settings -> 'company' ->> 'logo_url', '')), ''),
    CASE WHEN v_settings.vat_registered THEN v_settings.vat_number ELSE NULL END,
    v_customer.name,
    nullif(btrim(coalesce(v_customer.company_name, '')), ''),
    v_bill_address,
    nullif(btrim(coalesce(v_customer.email, '')), ''),
    v_settings.bank_account_name, v_settings.bank_sort_code, v_settings.bank_account_number,
    v_customer.bank_reference_hint,
    NULL, 0, 0, 0, 0,
    v_settings.invoice_footer,
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    auth.uid()
  );

  INSERT INTO public.invoice_lines (tenant_id, invoice_id, job_id, service_date, description, address, amount, sort_order)
  SELECT
    v_customer.tenant_id,
    v_invoice_id,
    j.id,
    coalesce(j.scheduled_date, (j.completed_at AT TIME ZONE 'Europe/London')::date),
    coalesce(nullif(btrim(j.custom_fields -> 'rounds' ->> 'service_name'), ''), j.job_description),
    j.address || coalesce(', ' || j.postcode, ''),
    round(coalesce(j.final_amount, j.quoted_amount, 0), 2),
    (row_number() OVER (ORDER BY coalesce(j.scheduled_date, (j.completed_at AT TIME ZONE 'Europe/London')::date), j.completed_at, j.id))::integer
  FROM public.jobs j
  WHERE j.id = ANY (p_job_ids)
    AND j.tenant_id = v_customer.tenant_id
    AND j.customer_id = v_customer.id
    AND j.status = 'completed'
    AND j.payment_status IS NOT NULL
    AND j.payment_status <> 'waived';

  GET DIAGNOSTICS v_lines = ROW_COUNT;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'Nothing to invoice' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(sum(l.amount), 0) INTO v_total
    FROM public.invoice_lines l WHERE l.invoice_id = v_invoice_id;

  SELECT coalesce(sum(a.amount), 0) INTO v_paid
    FROM public.payment_allocations a
   WHERE a.job_id IN (SELECT l.job_id FROM public.invoice_lines l WHERE l.invoice_id = v_invoice_id);

  IF v_settings.vat_registered THEN
    v_rate := v_settings.vat_rate_percent;
    v_net := round(v_total / (1 + v_rate / 100), 2);
    v_vat := v_total - v_net;
  ELSE
    v_rate := NULL;
    v_net := v_total;
    v_vat := 0;
  END IF;

  UPDATE public.invoices
     SET subtotal_net = v_net,
         vat_amount = v_vat,
         total = v_total,
         vat_rate_percent = v_rate,
         amount_paid_at_issue = least(v_paid, v_total)
   WHERE id = v_invoice_id;

  RETURN v_invoice_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invoice(uuid, uuid[], text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice(uuid, uuid[], text) TO authenticated, service_role;
