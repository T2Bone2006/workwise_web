-- Partner referrals: a person with no WorkWise account, given a code by hand.
-- A Rounds or Lite signup that types the code gets the same free-month offer as a
-- customer referral. The partner is not credited in Stripe. They earn 10% of the
-- subscription money that business pays during the 12 months from signup, and the
-- owner marks that paid from the admin page (no payout is sent from here).
-- Customer referral codes are still 8 characters on tenants.referral_code and are
-- checked first, so typing one of those does not create a partner row.

-- 1. The people.
CREATE TABLE IF NOT EXISTS public.referral_partners (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL,
  payout_note text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT referral_partners_pkey PRIMARY KEY (id),
  CONSTRAINT referral_partners_code_key UNIQUE (code),
  CONSTRAINT referral_partners_name_len CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  CONSTRAINT referral_partners_code_format CHECK (code ~ '^[A-Z0-9]{3,16}$'),
  CONSTRAINT referral_partners_payout_note_len CHECK (payout_note IS NULL OR char_length(payout_note) <= 200)
);

COMMENT ON TABLE public.referral_partners IS
  'Hand-picked referrers with no WorkWise account. 10% for 12 months, paid by the owner, tracked on the admin page.';
COMMENT ON COLUMN public.referral_partners.code IS
  'Typed at Rounds/Lite signup. 3–16 letters or digits. A live customer referral code wins if both exist.';
COMMENT ON COLUMN public.referral_partners.payout_note IS
  'Where the owner sends the money. Shown only on the admin page.';
COMMENT ON COLUMN public.referral_partners.active IS
  'False: new signups no longer get the offer. Rows already started keep their 12 months.';

DROP TRIGGER IF EXISTS referral_partners_set_updated_at ON public.referral_partners;
CREATE TRIGGER referral_partners_set_updated_at
  BEFORE UPDATE ON public.referral_partners
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.referral_partners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_partners FROM anon, authenticated;

-- 2. One row per business that signed up with a partner code.
CREATE TABLE IF NOT EXISTS public.partner_referrals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  referred_tenant_id uuid NOT NULL,
  signup_intent_id uuid,
  code text NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  window_ends_at timestamp with time zone NOT NULL,
  paid_pence integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT partner_referrals_pkey PRIMARY KEY (id),
  CONSTRAINT partner_referrals_partner_id_fkey FOREIGN KEY (partner_id)
    REFERENCES public.referral_partners(id) ON DELETE RESTRICT,
  CONSTRAINT partner_referrals_referred_tenant_id_fkey FOREIGN KEY (referred_tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT partner_referrals_signup_intent_id_fkey FOREIGN KEY (signup_intent_id)
    REFERENCES public.signup_intents(id) ON DELETE SET NULL,
  CONSTRAINT partner_referrals_tenant_key UNIQUE (referred_tenant_id),
  CONSTRAINT partner_referrals_code_format CHECK (code ~ '^[A-Z0-9]{3,16}$'),
  CONSTRAINT partner_referrals_paid_check CHECK (paid_pence >= 0),
  CONSTRAINT partner_referrals_window_check CHECK (window_ends_at > started_at)
);

COMMENT ON TABLE public.partner_referrals IS
  'A Rounds/Lite business that signed up with a partner code. 10% of subscription invoices paid in [started_at, window_ends_at). paid_pence is what the owner has marked as sent.';
COMMENT ON COLUMN public.partner_referrals.paid_pence IS
  'Set from the admin page to the 10% owed at that moment. Later invoices raise the amount owed again.';

CREATE INDEX IF NOT EXISTS idx_partner_referrals_partner ON public.partner_referrals (partner_id);

DROP TRIGGER IF EXISTS partner_referrals_set_updated_at ON public.partner_referrals;
CREATE TRIGGER partner_referrals_set_updated_at
  BEFORE UPDATE ON public.partner_referrals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.partner_referrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_referrals FROM anon, authenticated;

-- 3. The signup remembers which partner, without creating a customer-referral credit.
ALTER TABLE public.signup_intents
  ADD COLUMN IF NOT EXISTS partner_id uuid;

ALTER TABLE public.signup_intents
  DROP CONSTRAINT IF EXISTS signup_intents_partner_id_fkey;
ALTER TABLE public.signup_intents
  ADD CONSTRAINT signup_intents_partner_id_fkey
  FOREIGN KEY (partner_id) REFERENCES public.referral_partners(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.signup_intents.partner_id IS
  'Set when the typed code is a partner code. Provisioning writes partner_referrals. Never set together with referrer_tenant_id.';

-- A random customer code must not land on a partner word.
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
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tenants WHERE referral_code = v_code)
      AND NOT EXISTS (SELECT 1 FROM public.referral_partners WHERE code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.new_referral_code() FROM PUBLIC, anon, authenticated;
