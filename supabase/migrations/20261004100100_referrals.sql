-- Phase 7 migration 2: referral codes and referrals.
--
-- Every self-serve business gets a referral code (tenants.referral_code).
-- A referrals row is created by provisioning (migration 3) when a new
-- business signs up with a valid code. The referrer's free month (a Stripe
-- customer-balance credit) is given once, by lib/billing/referrals.ts:
--   waiting   -> rewarding (claimed by one webhook run)
--   rewarding -> rewarded  (credit made)  | -> waiting (Stripe failed, retry)
--   waiting   -> void      (referrer has no live plan, or the new trader left
--                           before paying a full month)

-- 1. Codes.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS referral_code text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_referral_code
  ON public.tenants (referral_code)
  WHERE referral_code IS NOT NULL;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_referral_code_format;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_referral_code_format
  CHECK (referral_code IS NULL OR referral_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$');

COMMENT ON COLUMN public.tenants.referral_code IS
  'Self-serve businesses only. 8 chars, no 0/O/1/I/L. Link: https://app.joinworkwise.com/r/<code>.';

-- Random bytes come from gen_random_uuid() (cryptographically random).
-- Bytes 6 and 8 of a v4 UUID carry fixed version/variant bits, so they're skipped.
CREATE OR REPLACE FUNCTION public.new_referral_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_positions constant int[] := ARRAY[0, 1, 2, 3, 4, 5, 10, 11];
  v_bytes bytea;
  v_code text;
  v_pos int;
BEGIN
  LOOP
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    FOREACH v_pos IN ARRAY v_positions LOOP
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_pos) % 31) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tenants WHERE referral_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.new_referral_code() FROM PUBLIC, anon, authenticated;

-- Backfill: existing self-serve businesses (a Stripe rounds/lite row, no Pro-tier row).
DO $$
DECLARE
  v_tenant record;
BEGIN
  FOR v_tenant IN
    SELECT t.id
    FROM public.tenants t
    WHERE t.referral_code IS NULL
      AND EXISTS (
        SELECT 1 FROM public.subscriptions s
        WHERE s.tenant_id = t.id AND s.source = 'stripe' AND s.product IN ('rounds', 'lite')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.subscriptions s
        WHERE s.tenant_id = t.id AND (s.source = 'manual' OR s.product IN ('starter', 'growth', 'pro'))
      )
  LOOP
    UPDATE public.tenants SET referral_code = public.new_referral_code() WHERE id = v_tenant.id;
  END LOOP;
END $$;

-- 2. Referrals.
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  referrer_tenant_id uuid NOT NULL,
  referred_tenant_id uuid NOT NULL,
  signup_intent_id uuid,
  code text NOT NULL,
  -- What the new trader got at Checkout (signup_intents.offer at the time).
  referee_offer text NOT NULL,
  status text NOT NULL DEFAULT 'waiting',
  reward_pence integer,
  qualifying_invoice_id text,
  stripe_balance_transaction_id text,
  claimed_at timestamp with time zone,
  rewarded_at timestamp with time zone,
  void_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT referrals_pkey PRIMARY KEY (id),
  CONSTRAINT referrals_referrer_tenant_id_fkey FOREIGN KEY (referrer_tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT referrals_referred_tenant_id_fkey FOREIGN KEY (referred_tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT referrals_signup_intent_id_fkey FOREIGN KEY (signup_intent_id)
    REFERENCES public.signup_intents(id) ON DELETE SET NULL,
  CONSTRAINT referrals_referred_tenant_key UNIQUE (referred_tenant_id),
  CONSTRAINT referrals_not_self CHECK (referrer_tenant_id <> referred_tenant_id),
  CONSTRAINT referrals_referee_offer_check CHECK (
    referee_offer IN ('none', 'founding', 'free_month', 'month_off_year')
  ),
  CONSTRAINT referrals_status_check CHECK (
    status IN ('waiting', 'rewarding', 'rewarded', 'void')
  ),
  CONSTRAINT referrals_reward_pence_check CHECK (reward_pence IS NULL OR reward_pence > 0),
  CONSTRAINT referrals_rewarded_has_txn CHECK (
    status <> 'rewarded' OR (stripe_balance_transaction_id IS NOT NULL AND rewarded_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.referrals IS
  'One row per business that signed up with another business''s referral code. Written by provisioning and lib/billing/referrals.ts (service role) only.';
COMMENT ON COLUMN public.referrals.status IS
  'waiting -> rewarding -> rewarded, or void. rewarding is a claim held by one webhook run.';
COMMENT ON COLUMN public.referrals.reward_pence IS
  'Credit given to the referrer: one month of their own plan (3500 or 5900).';

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_tenant_id);
CREATE INDEX IF NOT EXISTS idx_referrals_waiting ON public.referrals (referred_tenant_id) WHERE status = 'waiting';

DROP TRIGGER IF EXISTS referrals_set_updated_at ON public.referrals;
CREATE TRIGGER referrals_set_updated_at
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- The referrer's admins can see their own referrals (the Plan & billing panel).
DROP POLICY IF EXISTS "referrals_referrer_admin_select" ON public.referrals;
CREATE POLICY "referrals_referrer_admin_select" ON public.referrals FOR SELECT TO authenticated
USING (referrer_tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'));

REVOKE ALL ON public.referrals FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.referrals FROM authenticated;
GRANT SELECT ON public.referrals TO authenticated;
