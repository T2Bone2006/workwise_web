-- Texts safety net. Paste after 20261117120000.
--
-- A business that runs out of texts used to have its messages thrown away. This adds:
--   * a "waiting_texts" message state (a message waits until texts are available again)
--   * a monthly pot of grace texts for pay-link style messages (WorkWise pays)
--   * flags so the "running low" / "out" warnings only go once per refill
--   * auto top-up settings and a log of its charges (one a day, enforced by a unique key)
--
-- Additive only. Safe to paste twice. Only the server (service role) changes these tables.

-- 1. messages: a waiting state and a grace billing source -------------------------------------
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_status_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_status_check CHECK (status IN (
  'held', 'queued', 'sent', 'delivered', 'failed', 'skipped', 'received', 'waiting_texts'
));

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_billed_from_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_billed_from_check
  CHECK (billed_from IS NULL OR billed_from IN ('allowance', 'pack', 'grace'));

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS waiting_since timestamp with time zone;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS waiting_expires_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_messages_waiting
  ON public.messages (tenant_id, waiting_expires_at)
  WHERE status = 'waiting_texts';

-- 2. tenant_text_balance: grace counters and warning flags --------------------------------------
ALTER TABLE public.tenant_text_balance ADD COLUMN IF NOT EXISTS grace_month text;
ALTER TABLE public.tenant_text_balance ADD COLUMN IF NOT EXISTS grace_used integer NOT NULL DEFAULT 0;
ALTER TABLE public.tenant_text_balance ADD COLUMN IF NOT EXISTS low_warned_at timestamp with time zone;
ALTER TABLE public.tenant_text_balance ADD COLUMN IF NOT EXISTS out_warned_at timestamp with time zone;

ALTER TABLE public.tenant_text_balance DROP CONSTRAINT IF EXISTS tenant_text_balance_grace_check;
ALTER TABLE public.tenant_text_balance ADD CONSTRAINT tenant_text_balance_grace_check
  CHECK (grace_used >= 0);

-- 3. Take grace texts. Returns 'grace' (taken) or 'none' (nothing changed).
-- p_limit is the monthly grace amount (30), passed in by the app. Under a row lock, so two
-- sends at once cannot both take the last grace text.
CREATE OR REPLACE FUNCTION public.claim_grace_texts(
  p_tenant_id uuid,
  p_segments integer,
  p_limit integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month text := public.text_month_london();
  v_row public.tenant_text_balance%ROWTYPE;
  v_used integer;
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

  v_used := CASE WHEN v_row.grace_month IS NOT DISTINCT FROM v_month THEN v_row.grace_used ELSE 0 END;

  IF coalesce(p_limit, 0) <= 0 OR v_used + p_segments > p_limit THEN
    RETURN 'none';
  END IF;

  UPDATE public.tenant_text_balance
     SET grace_month = v_month,
         grace_used = v_used + p_segments
   WHERE tenant_id = p_tenant_id;

  RETURN 'grace';
END;
$$;

-- 4. Give back texts that never left. Now also knows grace. Same signature as before.
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
  ELSIF p_from = 'grace' THEN
    UPDATE public.tenant_text_balance
       SET grace_used = greatest(grace_used - p_segments, 0)
     WHERE tenant_id = p_tenant_id
       AND grace_month = p_month;
  END IF;
END;
$$;

-- 5. Auto top-up settings (one row per business) ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.text_auto_topup (
  tenant_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  pack_key text NOT NULL DEFAULT 'texts_250',
  -- Buy a pack when texts left falls to this number or below.
  trigger_left integer NOT NULL DEFAULT 20,
  -- The most auto top-up may spend in one London calendar month, in pence.
  monthly_cap_pence integer NOT NULL DEFAULT 5000,
  prompt_dismissed_count integer NOT NULL DEFAULT 0,
  -- Stripe payment method (pm_...). Never a card number.
  payment_method_id text,
  paused_reason text,
  paused_at timestamp with time zone,
  enabled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT text_auto_topup_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT text_auto_topup_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT text_auto_topup_pack_check CHECK (pack_key IN ('texts_250', 'texts_1000')),
  CONSTRAINT text_auto_topup_trigger_check CHECK (trigger_left BETWEEN 5 AND 200),
  CONSTRAINT text_auto_topup_cap_check CHECK (monthly_cap_pence BETWEEN 100 AND 100000),
  CONSTRAINT text_auto_topup_dismissed_check CHECK (prompt_dismissed_count >= 0),
  CONSTRAINT text_auto_topup_paused_check CHECK (
    paused_reason IS NULL OR paused_reason IN ('card_failed', 'needs_authentication', 'no_card')
  )
);

DROP TRIGGER IF EXISTS text_auto_topup_set_updated_at ON public.text_auto_topup;
CREATE TRIGGER text_auto_topup_set_updated_at
  BEFORE UPDATE ON public.text_auto_topup
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Auto top-up charges. The unique (tenant_id, day_key) is "one a day": a charge claims its
-- day by inserting a row BEFORE Stripe is called.
CREATE TABLE IF NOT EXISTS public.text_auto_topup_charges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  day_key date NOT NULL,
  month text NOT NULL,
  pack_key text NOT NULL,
  texts integer NOT NULL,
  amount_pence integer NOT NULL,
  status text NOT NULL,
  stripe_payment_intent_id text,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT text_auto_topup_charges_pkey PRIMARY KEY (id),
  CONSTRAINT text_auto_topup_charges_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT text_auto_topup_charges_day_unique UNIQUE (tenant_id, day_key),
  CONSTRAINT text_auto_topup_charges_month_check CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT text_auto_topup_charges_pack_check CHECK (pack_key IN ('texts_250', 'texts_1000')),
  CONSTRAINT text_auto_topup_charges_texts_check CHECK (texts > 0),
  CONSTRAINT text_auto_topup_charges_amount_check CHECK (amount_pence >= 0),
  CONSTRAINT text_auto_topup_charges_status_check CHECK (status IN ('pending', 'paid', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_text_auto_topup_charges_intent
  ON public.text_auto_topup_charges (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_text_auto_topup_charges_tenant_month
  ON public.text_auto_topup_charges (tenant_id, month);
CREATE INDEX IF NOT EXISTS idx_text_auto_topup_charges_pending
  ON public.text_auto_topup_charges (created_at) WHERE status = 'pending';

DROP TRIGGER IF EXISTS text_auto_topup_charges_set_updated_at ON public.text_auto_topup_charges;
CREATE TRIGGER text_auto_topup_charges_set_updated_at
  BEFORE UPDATE ON public.text_auto_topup_charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Row security: the business owner can read their own rows; only the server writes ----------
ALTER TABLE public.text_auto_topup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.text_auto_topup_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "text_auto_topup_admin_select" ON public.text_auto_topup;
CREATE POLICY "text_auto_topup_admin_select"
ON public.text_auto_topup FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "text_auto_topup_charges_admin_select" ON public.text_auto_topup_charges;
CREATE POLICY "text_auto_topup_charges_admin_select"
ON public.text_auto_topup_charges FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

REVOKE ALL ON public.text_auto_topup FROM anon;
REVOKE ALL ON public.text_auto_topup_charges FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.text_auto_topup FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.text_auto_topup_charges FROM authenticated;
GRANT SELECT ON public.text_auto_topup TO authenticated;
GRANT SELECT ON public.text_auto_topup_charges TO authenticated;

-- 8. Function permissions ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.claim_grace_texts(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_grace_texts(uuid, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.refund_text_credits(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_text_credits(uuid, integer, text, text) TO service_role;
