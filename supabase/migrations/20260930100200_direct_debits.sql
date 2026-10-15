-- Phase 4 (Direct Debit through GoCardless), file 3 of 4. Paste after
-- 20260930100100_owner_pushes, before 20260930100300_more_ways_to_pay.
--
-- gocardless_connections: the business's own GoCardless account (one per tenant).
--   access_token_enc and oauth_* are never readable by tenant logins.
-- gocardless_events: every webhook event, stored before it is processed.
-- customer_direct_debits: a customer's Direct Debit (GoCardless mandate).
-- direct_debit_collections: each attempt to collect (one GoCardless payment).
-- gocardless_mandate_links: Direct Debits already in a switcher's GoCardless
--   account, waiting to be matched to WorkWise customers.
-- gocardless_pay_requests: each Pay by Bank attempt through GoCardless (D17).
-- payments: + gocardless_payment_id; method + 'direct_debit'; source + 'gocardless'.
-- messages.kind + 'dd_invite', 'dd_failed'.
--
-- Written only by server code with the service role. Tenant logins may read
-- (except secrets). Additive (three CHECKs widened). Idempotent.

-- ---------------------------------------------------------------------------
-- 1. gocardless_connections

CREATE TABLE IF NOT EXISTS public.gocardless_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'not_connected',
  organisation_id text,
  creditor_id text,
  access_token_enc text,
  connected_email text,
  verification_status text,
  verification_checked_at timestamp with time zone,
  mandates_checked_at timestamp with time zone,
  connected_at timestamp with time zone,
  disconnected_at timestamp with time zone,
  disconnect_reason text,
  oauth_state_hash text,
  oauth_state_expires_at timestamp with time zone,
  oauth_from text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT gocardless_connections_pkey PRIMARY KEY (id),
  CONSTRAINT gocardless_connections_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT gocardless_connections_tenant_key UNIQUE (tenant_id),
  CONSTRAINT gocardless_connections_status_check CHECK (
    status IN ('not_connected', 'connected', 'disconnected')
  ),
  CONSTRAINT gocardless_connections_connected_check CHECK (
    status <> 'connected' OR (organisation_id IS NOT NULL AND access_token_enc IS NOT NULL)
  ),
  CONSTRAINT gocardless_connections_verification_check CHECK (
    verification_status IS NULL OR verification_status IN ('successful', 'in_review', 'action_required')
  ),
  CONSTRAINT gocardless_connections_oauth_from_check CHECK (
    oauth_from IS NULL OR oauth_from IN ('web', 'app')
  ),
  CONSTRAINT gocardless_connections_reason_len CHECK (
    disconnect_reason IS NULL OR char_length(disconnect_reason) <= 200
  ),
  CONSTRAINT gocardless_connections_email_len CHECK (
    connected_email IS NULL OR char_length(connected_email) <= 254
  )
);

COMMENT ON TABLE public.gocardless_connections IS
  'Phase 4: the business''s own GoCardless account connected to WorkWise''s partner app. access_token_enc = AES-256-GCM (lib/gocardless/crypto.ts), never readable by tenant logins. oauth_state_hash = SHA-256 of the pending OAuth state (30-minute expiry).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_gocardless_connections_organisation
  ON public.gocardless_connections (organisation_id)
  WHERE organisation_id IS NOT NULL AND status = 'connected';
CREATE UNIQUE INDEX IF NOT EXISTS uq_gocardless_connections_state
  ON public.gocardless_connections (oauth_state_hash)
  WHERE oauth_state_hash IS NOT NULL;

DROP TRIGGER IF EXISTS gocardless_connections_set_updated_at ON public.gocardless_connections;
CREATE TRIGGER gocardless_connections_set_updated_at
  BEFORE UPDATE ON public.gocardless_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. gocardless_events (service role only — no tenant access at all)

CREATE TABLE IF NOT EXISTS public.gocardless_events (
  id text NOT NULL,
  organisation_id text,
  tenant_id uuid,
  resource_type text NOT NULL,
  action text NOT NULL,
  resource_id text,
  payload jsonb NOT NULL,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  CONSTRAINT gocardless_events_pkey PRIMARY KEY (id),
  CONSTRAINT gocardless_events_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT gocardless_events_error_len CHECK (last_error IS NULL OR char_length(last_error) <= 500)
);

COMMENT ON TABLE public.gocardless_events IS
  'Phase 4: every GoCardless webhook event, inserted before processing (id = GoCardless event id; the organisation-disconnected event has no id, so it is stored as disconnect_<organisation>_<created_at>). processed_at null = still to do (the 07:00 sweep retries).';

CREATE INDEX IF NOT EXISTS idx_gocardless_events_pending
  ON public.gocardless_events (received_at)
  WHERE processed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. customer_direct_debits

CREATE TABLE IF NOT EXISTS public.customer_direct_debits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  gocardless_organisation_id text NOT NULL,
  gocardless_billing_request_id text,
  gocardless_customer_id text,
  gocardless_mandate_id text,
  source text NOT NULL DEFAULT 'workwise',
  status text NOT NULL DEFAULT 'setting_up',
  bank_name text,
  account_number_ending text,
  mandate_reference text,
  next_possible_charge_date date,
  other_collections_confirmed_at timestamp with time zone,
  cancelled_by text,
  inactive_reason text,
  activated_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT customer_direct_debits_pkey PRIMARY KEY (id),
  CONSTRAINT customer_direct_debits_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT customer_direct_debits_customer_fkey FOREIGN KEY (customer_id)
    REFERENCES public.customers(id) ON DELETE CASCADE,
  CONSTRAINT customer_direct_debits_source_check CHECK (source IN ('workwise', 'imported')),
  CONSTRAINT customer_direct_debits_status_check CHECK (
    status IN ('setting_up', 'pending', 'active', 'inactive', 'cancelled')
  ),
  CONSTRAINT customer_direct_debits_mandate_needed CHECK (
    status = 'setting_up' OR gocardless_mandate_id IS NOT NULL
  ),
  CONSTRAINT customer_direct_debits_cancelled_by_check CHECK (
    cancelled_by IS NULL OR cancelled_by IN ('customer', 'trader', 'bank')
  ),
  CONSTRAINT customer_direct_debits_ending_check CHECK (
    account_number_ending IS NULL OR account_number_ending ~ '^[0-9]{2}$'
  ),
  CONSTRAINT customer_direct_debits_text_len CHECK (
    (bank_name IS NULL OR char_length(bank_name) <= 80)
    AND (mandate_reference IS NULL OR char_length(mandate_reference) <= 40)
    AND (inactive_reason IS NULL OR char_length(inactive_reason) <= 200)
  )
);

COMMENT ON TABLE public.customer_direct_debits IS
  'Phase 4: a customer''s Direct Debit (GoCardless mandate on the business''s own GoCardless account). setting_up = GoCardless page opened; pending = submitted, bank not confirmed; active; inactive = refused, failed, expired or blocked; cancelled = customer, trader or bank cancelled. source imported = already in a switcher''s GoCardless account (D21).';
COMMENT ON COLUMN public.customer_direct_debits.other_collections_confirmed_at IS
  'Phase 4 (D22): when the trader ticked "I''ve stopped collecting in my old app" for this Direct Debit.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_direct_debits_live
  ON public.customer_direct_debits (customer_id)
  WHERE status IN ('pending', 'active');
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_direct_debits_billing_request
  ON public.customer_direct_debits (gocardless_billing_request_id)
  WHERE gocardless_billing_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_direct_debits_mandate
  ON public.customer_direct_debits (gocardless_mandate_id)
  WHERE gocardless_mandate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_direct_debits_tenant
  ON public.customer_direct_debits (tenant_id, status);

DROP TRIGGER IF EXISTS customer_direct_debits_set_updated_at ON public.customer_direct_debits;
CREATE TRIGGER customer_direct_debits_set_updated_at
  BEFORE UPDATE ON public.customer_direct_debits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. direct_debit_collections

CREATE TABLE IF NOT EXISTS public.direct_debit_collections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  direct_debit_id uuid NOT NULL,
  amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'creating',
  created_by text NOT NULL,
  created_by_user_id uuid,
  gocardless_payment_id text,
  gocardless_status text,
  charge_date date,
  failure_code text,
  failure_message text,
  resolution text,
  resolved_at timestamp with time zone,
  resolved_by_user_id uuid,
  payment_id uuid,
  submitted_at timestamp with time zone,
  finished_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT direct_debit_collections_pkey PRIMARY KEY (id),
  CONSTRAINT direct_debit_collections_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT direct_debit_collections_customer_fkey FOREIGN KEY (customer_id)
    REFERENCES public.customers(id) ON DELETE CASCADE,
  CONSTRAINT direct_debit_collections_dd_fkey FOREIGN KEY (direct_debit_id)
    REFERENCES public.customer_direct_debits(id) ON DELETE CASCADE,
  CONSTRAINT direct_debit_collections_payment_fkey FOREIGN KEY (payment_id)
    REFERENCES public.payments(id) ON DELETE SET NULL,
  CONSTRAINT direct_debit_collections_created_by_user_fkey FOREIGN KEY (created_by_user_id)
    REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT direct_debit_collections_resolved_by_fkey FOREIGN KEY (resolved_by_user_id)
    REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT direct_debit_collections_amount_check CHECK (amount >= 1 AND amount <= 1000),
  CONSTRAINT direct_debit_collections_status_check CHECK (
    status IN ('creating', 'processing', 'succeeded', 'failed', 'error', 'cancelled')
  ),
  CONSTRAINT direct_debit_collections_created_by_check CHECK (created_by IN ('cron', 'trader')),
  CONSTRAINT direct_debit_collections_resolution_check CHECK (
    (resolution IS NULL AND resolved_at IS NULL)
    OR (status = 'failed' AND resolution IN ('collect_again', 'left') AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT direct_debit_collections_text_len CHECK (
    (failure_code IS NULL OR char_length(failure_code) <= 80)
    AND (failure_message IS NULL OR char_length(failure_message) <= 300)
    AND (gocardless_status IS NULL OR char_length(gocardless_status) <= 40)
  )
);

COMMENT ON TABLE public.direct_debit_collections IS
  'Phase 4: one attempt to collect by Direct Debit (one GoCardless payment). creating (row written before GoCardless is called) → processing → succeeded | failed; error = GoCardless refused before submission (nothing taken); cancelled = payment cancelled. A failed row with resolution NULL is held (not collected again) until the trader chooses Collect again or Leave it.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_direct_debit_collections_payment
  ON public.direct_debit_collections (gocardless_payment_id)
  WHERE gocardless_payment_id IS NOT NULL;
-- One collection being created per customer at a time: the evening cron and a
-- trader's "Collect again" can't both work out and take the same money.
CREATE UNIQUE INDEX IF NOT EXISTS uq_direct_debit_collections_one_creating
  ON public.direct_debit_collections (customer_id)
  WHERE status = 'creating';
CREATE INDEX IF NOT EXISTS idx_direct_debit_collections_customer
  ON public.direct_debit_collections (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_direct_debit_collections_tenant
  ON public.direct_debit_collections (tenant_id, status, created_at DESC);

DROP TRIGGER IF EXISTS direct_debit_collections_set_updated_at ON public.direct_debit_collections;
CREATE TRIGGER direct_debit_collections_set_updated_at
  BEFORE UPDATE ON public.direct_debit_collections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. gocardless_mandate_links (existing Direct Debits to match — D21, D22)

CREATE TABLE IF NOT EXISTS public.gocardless_mandate_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  gocardless_organisation_id text NOT NULL,
  gocardless_mandate_id text NOT NULL,
  gocardless_customer_id text,
  mandate_status text NOT NULL,
  mandate_reference text,
  mandate_created_at timestamp with time zone,
  payer_name text,
  payer_email text,
  payer_postcode text,
  bank_name text,
  account_number_ending text,
  other_collections integer NOT NULL DEFAULT 0,
  other_collections_detail text,
  match_kind text NOT NULL DEFAULT 'none',
  suggested_customer_id uuid,
  decision text NOT NULL DEFAULT 'pending',
  linked_customer_id uuid,
  direct_debit_id uuid,
  decided_at timestamp with time zone,
  decided_by_user_id uuid,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT gocardless_mandate_links_pkey PRIMARY KEY (id),
  CONSTRAINT gocardless_mandate_links_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT gocardless_mandate_links_suggested_fkey FOREIGN KEY (suggested_customer_id)
    REFERENCES public.customers(id) ON DELETE SET NULL,
  CONSTRAINT gocardless_mandate_links_linked_fkey FOREIGN KEY (linked_customer_id)
    REFERENCES public.customers(id) ON DELETE SET NULL,
  CONSTRAINT gocardless_mandate_links_dd_fkey FOREIGN KEY (direct_debit_id)
    REFERENCES public.customer_direct_debits(id) ON DELETE SET NULL,
  CONSTRAINT gocardless_mandate_links_user_fkey FOREIGN KEY (decided_by_user_id)
    REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT gocardless_mandate_links_mandate_key UNIQUE (tenant_id, gocardless_mandate_id),
  CONSTRAINT gocardless_mandate_links_match_check CHECK (match_kind IN ('email', 'name_postcode', 'none')),
  CONSTRAINT gocardless_mandate_links_decision_check CHECK (decision IN ('pending', 'linked', 'ignored')),
  CONSTRAINT gocardless_mandate_links_other_check CHECK (other_collections >= 0),
  CONSTRAINT gocardless_mandate_links_ending_check CHECK (
    account_number_ending IS NULL OR account_number_ending ~ '^[0-9]{2}$'
  ),
  CONSTRAINT gocardless_mandate_links_text_len CHECK (
    (payer_name IS NULL OR char_length(payer_name) <= 140)
    AND (payer_email IS NULL OR char_length(payer_email) <= 254)
    AND (payer_postcode IS NULL OR char_length(payer_postcode) <= 12)
    AND (bank_name IS NULL OR char_length(bank_name) <= 80)
    AND (mandate_reference IS NULL OR char_length(mandate_reference) <= 40)
    AND (other_collections_detail IS NULL OR char_length(other_collections_detail) <= 300)
  )
);

COMMENT ON TABLE public.gocardless_mandate_links IS
  'Phase 4 (D21/D22): Direct Debits found in a switcher''s GoCardless account. match_kind email = linked automatically (unless other_collections > 0); name_postcode = probable, trader confirms; none = trader picks or ignores. other_collections = subscriptions or waiting payments WorkWise did not make (the old app).';

CREATE INDEX IF NOT EXISTS idx_gocardless_mandate_links_pending
  ON public.gocardless_mandate_links (tenant_id, decision);

DROP TRIGGER IF EXISTS gocardless_mandate_links_set_updated_at ON public.gocardless_mandate_links;
CREATE TRIGGER gocardless_mandate_links_set_updated_at
  BEFORE UPDATE ON public.gocardless_mandate_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5b. gocardless_pay_requests (Pay by Bank through GoCardless — D17, step 19a)

CREATE TABLE IF NOT EXISTS public.gocardless_pay_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  invoice_id uuid,
  kind text NOT NULL,
  amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'started',
  gocardless_organisation_id text NOT NULL,
  gocardless_billing_request_id text NOT NULL,
  gocardless_payment_id text,
  direct_debit_id uuid,
  payment_id uuid,
  failure_message text,
  fulfilled_at timestamp with time zone,
  finished_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT gocardless_pay_requests_pkey PRIMARY KEY (id),
  CONSTRAINT gocardless_pay_requests_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT gocardless_pay_requests_customer_fkey FOREIGN KEY (customer_id)
    REFERENCES public.customers(id) ON DELETE CASCADE,
  CONSTRAINT gocardless_pay_requests_invoice_fkey FOREIGN KEY (invoice_id)
    REFERENCES public.invoices(id) ON DELETE SET NULL,
  CONSTRAINT gocardless_pay_requests_dd_fkey FOREIGN KEY (direct_debit_id)
    REFERENCES public.customer_direct_debits(id) ON DELETE SET NULL,
  CONSTRAINT gocardless_pay_requests_payment_fkey FOREIGN KEY (payment_id)
    REFERENCES public.payments(id) ON DELETE SET NULL,
  CONSTRAINT gocardless_pay_requests_billing_request_key UNIQUE (gocardless_billing_request_id),
  CONSTRAINT gocardless_pay_requests_kind_check CHECK (kind IN ('pay_by_bank', 'pay_and_dd')),
  CONSTRAINT gocardless_pay_requests_status_check CHECK (
    status IN ('started', 'fulfilled', 'paid', 'failed', 'cancelled')
  ),
  CONSTRAINT gocardless_pay_requests_amount_check CHECK (amount >= 1 AND amount <= 5000),
  CONSTRAINT gocardless_pay_requests_failure_len CHECK (failure_message IS NULL OR char_length(failure_message) <= 300)
);

COMMENT ON TABLE public.gocardless_pay_requests IS
  'Phase 4 (D17): one Pay by Bank attempt through GoCardless (billing request with a payment request; pay_and_dd also sets up a Direct Debit). started = GoCardless page opened; fulfilled = customer approved in their bank (money on its way — not paid yet); paid = GoCardless confirmed (payments row written); failed / cancelled.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_gocardless_pay_requests_payment
  ON public.gocardless_pay_requests (gocardless_payment_id)
  WHERE gocardless_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gocardless_pay_requests_customer
  ON public.gocardless_pay_requests (customer_id, status);

DROP TRIGGER IF EXISTS gocardless_pay_requests_set_updated_at ON public.gocardless_pay_requests;
CREATE TRIGGER gocardless_pay_requests_set_updated_at
  BEFORE UPDATE ON public.gocardless_pay_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. RLS: tenant logins read (not secrets); only the service role writes.

ALTER TABLE public.gocardless_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gocardless_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_direct_debits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_debit_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gocardless_mandate_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gocardless_pay_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gocardless_connections_tenant_select" ON public.gocardless_connections;
CREATE POLICY "gocardless_connections_tenant_select"
ON public.gocardless_connections FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  OR tenant_id IN (SELECT primary_tenant_id FROM public.workers WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "customer_direct_debits_tenant_select" ON public.customer_direct_debits;
CREATE POLICY "customer_direct_debits_tenant_select"
ON public.customer_direct_debits FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  OR tenant_id IN (SELECT primary_tenant_id FROM public.workers WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "direct_debit_collections_tenant_select" ON public.direct_debit_collections;
CREATE POLICY "direct_debit_collections_tenant_select"
ON public.direct_debit_collections FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  OR tenant_id IN (SELECT primary_tenant_id FROM public.workers WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "gocardless_mandate_links_tenant_select" ON public.gocardless_mandate_links;
CREATE POLICY "gocardless_mandate_links_tenant_select"
ON public.gocardless_mandate_links FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  OR tenant_id IN (SELECT primary_tenant_id FROM public.workers WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "gocardless_pay_requests_tenant_select" ON public.gocardless_pay_requests;
CREATE POLICY "gocardless_pay_requests_tenant_select"
ON public.gocardless_pay_requests FOR SELECT TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  OR tenant_id IN (SELECT primary_tenant_id FROM public.workers WHERE user_id = auth.uid())
);

REVOKE ALL ON public.gocardless_connections FROM anon, authenticated;
REVOKE ALL ON public.gocardless_events FROM anon, authenticated;
REVOKE ALL ON public.customer_direct_debits FROM anon, authenticated;
REVOKE ALL ON public.direct_debit_collections FROM anon, authenticated;
REVOKE ALL ON public.gocardless_mandate_links FROM anon, authenticated;
REVOKE ALL ON public.gocardless_pay_requests FROM anon, authenticated;

-- Column-level: the token and the OAuth state are never readable by logins.
GRANT SELECT (
  id, tenant_id, status, organisation_id, creditor_id, connected_email,
  verification_status, verification_checked_at, mandates_checked_at,
  connected_at, disconnected_at, disconnect_reason, created_at, updated_at
) ON public.gocardless_connections TO authenticated;
GRANT SELECT ON public.customer_direct_debits TO authenticated;
GRANT SELECT ON public.direct_debit_collections TO authenticated;
GRANT SELECT ON public.gocardless_mandate_links TO authenticated;
GRANT SELECT ON public.gocardless_pay_requests TO authenticated;
-- gocardless_events: no grant at all (service role only).

-- ---------------------------------------------------------------------------
-- 7. payments: + gocardless_payment_id; method + 'direct_debit'; source + 'gocardless'

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS gocardless_payment_id text;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_gocardless_payment_id_key;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_gocardless_payment_id_key UNIQUE (gocardless_payment_id);

COMMENT ON COLUMN public.payments.gocardless_payment_id IS
  'Phase 4: the GoCardless payment behind a Direct Debit (source = gocardless). Unique, so a redelivered event cannot record the money twice.';

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_method_check CHECK (
    method IN ('cash', 'cheque', 'bank_transfer', 'card', 'direct_debit', 'other')
  );

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_source_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_source_check CHECK (
    source IN ('manual', 'stripe', 'open_banking', 'gocardless')
  );

-- ---------------------------------------------------------------------------
-- 8. messages.kind: + 'dd_invite', 'dd_failed'

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_kind_check CHECK (kind IN (
    'reminder', 'visit_done', 'chaser', 'payment_received', 'visit_change', 'reply_ack', 'inbound',
    'dd_invite', 'dd_failed'
  ));
