-- Phase 3 (messaging), file 2 of 3. Paste after 20260929100000, before 20260929100200.
--
-- Texts: 100 free per business per London calendar month, then bought packs
-- (never expire). One row per business holds this month's usage and the pack
-- balance. Only the functions below change it, under a row lock, so two texts
-- sent at the same moment can never both take the last credit.
--
-- The allowance number is passed in by the app (lib/messaging/credits.ts) so
-- changing it needs no SQL.

CREATE TABLE IF NOT EXISTS public.tenant_text_balance (
  tenant_id uuid NOT NULL,
  -- 'YYYY-MM' in Europe/London. When it differs from the current month the
  -- next claim resets month_used to 0.
  month text NOT NULL,
  month_used integer NOT NULL DEFAULT 0,
  pack_balance integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tenant_text_balance_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT tenant_text_balance_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT tenant_text_balance_month_check CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT tenant_text_balance_used_check CHECK (month_used >= 0),
  CONSTRAINT tenant_text_balance_pack_check CHECK (pack_balance >= 0)
);

DROP TRIGGER IF EXISTS tenant_text_balance_set_updated_at ON public.tenant_text_balance;
CREATE TRIGGER tenant_text_balance_set_updated_at
  BEFORE UPDATE ON public.tenant_text_balance
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.text_pack_purchases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pack_key text NOT NULL,
  texts integer NOT NULL,
  amount_pence integer NOT NULL,
  currency text NOT NULL DEFAULT 'gbp',
  stripe_checkout_session_id text NOT NULL,
  stripe_payment_intent_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT text_pack_purchases_pkey PRIMARY KEY (id),
  CONSTRAINT text_pack_purchases_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT text_pack_purchases_session_key UNIQUE (stripe_checkout_session_id),
  CONSTRAINT text_pack_purchases_pack_key_check CHECK (pack_key IN ('texts_250', 'texts_1000')),
  CONSTRAINT text_pack_purchases_texts_check CHECK (texts > 0),
  CONSTRAINT text_pack_purchases_amount_check CHECK (amount_pence >= 0)
);

CREATE INDEX IF NOT EXISTS idx_text_pack_purchases_tenant
  ON public.text_pack_purchases (tenant_id, created_at DESC);

-- RLS: admins read their own balance and purchases (the texts meter). No writes.
ALTER TABLE public.tenant_text_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.text_pack_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_text_balance_admin_select" ON public.tenant_text_balance;
CREATE POLICY "tenant_text_balance_admin_select"
ON public.tenant_text_balance FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "text_pack_purchases_admin_select" ON public.text_pack_purchases;
CREATE POLICY "text_pack_purchases_admin_select"
ON public.text_pack_purchases FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

REVOKE ALL ON public.tenant_text_balance FROM anon;
REVOKE ALL ON public.text_pack_purchases FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.tenant_text_balance FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.text_pack_purchases FROM authenticated;
GRANT SELECT ON public.tenant_text_balance TO authenticated;
GRANT SELECT ON public.text_pack_purchases TO authenticated;

-- The current month in London, e.g. '2026-10'.
CREATE OR REPLACE FUNCTION public.text_month_london(p_at timestamp with time zone DEFAULT now())
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_char(p_at AT TIME ZONE 'Europe/London', 'YYYY-MM');
$$;

-- Take p_segments texts. Returns where they came from:
--   'allowance' — this month's free texts (only if ALL p_segments fit)
--   'pack'      — bought texts
--   'none'      — not enough of either; nothing was taken
-- p_allowance is the monthly free amount (100), passed in by the app.
CREATE OR REPLACE FUNCTION public.claim_text_credits(
  p_tenant_id uuid,
  p_segments integer,
  p_allowance integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month text := public.text_month_london();
  v_row public.tenant_text_balance%ROWTYPE;
  v_from text;
BEGIN
  IF p_segments IS NULL OR p_segments < 1 THEN
    RAISE EXCEPTION 'p_segments must be >= 1';
  END IF;

  INSERT INTO public.tenant_text_balance (tenant_id, month)
  VALUES (p_tenant_id, v_month)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT * INTO v_row
    FROM public.tenant_text_balance
   WHERE tenant_id = p_tenant_id
   FOR UPDATE;

  IF v_row.month <> v_month THEN
    v_row.month := v_month;
    v_row.month_used := 0;
  END IF;

  IF v_row.month_used + p_segments <= p_allowance THEN
    v_row.month_used := v_row.month_used + p_segments;
    v_from := 'allowance';
  ELSIF v_row.pack_balance >= p_segments THEN
    v_row.pack_balance := v_row.pack_balance - p_segments;
    v_from := 'pack';
  ELSE
    v_from := 'none';
  END IF;

  UPDATE public.tenant_text_balance
     SET month = v_row.month,
         month_used = v_row.month_used,
         pack_balance = v_row.pack_balance
   WHERE tenant_id = p_tenant_id;

  RETURN v_from;
END;
$$;

-- Give back texts that never left (the provider refused the send). An
-- allowance refund only applies if it is still the same month.
CREATE OR REPLACE FUNCTION public.refund_text_credits(
  p_tenant_id uuid,
  p_segments integer,
  p_from text,
  p_month text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_segments IS NULL OR p_segments < 1 THEN
    RETURN;
  END IF;
  IF p_from = 'allowance' THEN
    UPDATE public.tenant_text_balance
       SET month_used = greatest(month_used - p_segments, 0)
     WHERE tenant_id = p_tenant_id
       AND month = p_month;
  ELSIF p_from = 'pack' THEN
    UPDATE public.tenant_text_balance
       SET pack_balance = pack_balance + p_segments
     WHERE tenant_id = p_tenant_id;
  END IF;
END;
$$;

-- Credit a bought pack exactly once per Stripe Checkout Session.
-- Returns true if the texts were added now, false if this session was
-- already credited (webhook redelivery).
CREATE OR REPLACE FUNCTION public.add_text_pack(
  p_tenant_id uuid,
  p_pack_key text,
  p_texts integer,
  p_amount_pence integer,
  p_checkout_session_id text,
  p_payment_intent_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted uuid;
BEGIN
  INSERT INTO public.text_pack_purchases (
    tenant_id, pack_key, texts, amount_pence, stripe_checkout_session_id, stripe_payment_intent_id
  )
  VALUES (
    p_tenant_id, p_pack_key, p_texts, p_amount_pence, p_checkout_session_id, p_payment_intent_id
  )
  ON CONFLICT (stripe_checkout_session_id) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.tenant_text_balance (tenant_id, month, pack_balance)
  VALUES (p_tenant_id, public.text_month_london(), p_texts)
  ON CONFLICT (tenant_id) DO UPDATE
    SET pack_balance = public.tenant_text_balance.pack_balance + EXCLUDED.pack_balance;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_text_credits(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_text_credits(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_text_pack(uuid, text, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_text_credits(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_text_credits(uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_text_pack(uuid, text, integer, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.text_month_london(timestamp with time zone) TO authenticated, service_role;
