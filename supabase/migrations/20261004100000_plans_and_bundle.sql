-- Phase 7 migration 1: plans, yearly and the Rounds + Lite bundle.
--
-- A Stripe subscription can now unlock two products: the £59 bundle is ONE
-- Stripe subscription with ONE price, stored as two rows here (product
-- 'rounds' and product 'lite') so every reader that checks product = 'rounds'
-- or 'lite' keeps working. plan/billing_interval record what was bought.
--
-- Paste together with migrations 2-4 (20261004100100..300): the old
-- provision_tenant_from_intent uses ON CONFLICT (stripe_subscription_id),
-- which stops matching once this runs; migration 3 replaces it.

-- 1. One row per (Stripe subscription, product) instead of per subscription.
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_stripe_subscription_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscriptions_stripe_sub_product_key'
      AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    -- NULL stripe_subscription_id (manual rows) never collide: NULLs are distinct.
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_stripe_sub_product_key
      UNIQUE (stripe_subscription_id, product);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id
  ON public.subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- 2. What was bought.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan text,
  ADD COLUMN IF NOT EXISTS billing_interval text;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IS NULL OR plan IN ('rounds', 'lite', 'both'));

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_billing_interval_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_billing_interval_check
  CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year'));

COMMENT ON COLUMN public.subscriptions.plan IS
  'Self-serve plan bought: rounds | lite | both (the bundle writes a rounds row and a lite row with the same stripe_subscription_id). NULL for Pro/manual rows.';
COMMENT ON COLUMN public.subscriptions.billing_interval IS
  'month | year for self-serve plans. NULL for Pro/manual rows.';

-- Existing self-serve rows were all monthly single-product plans.
UPDATE public.subscriptions
SET plan = product,
    billing_interval = 'month'
WHERE source = 'stripe'
  AND product IN ('rounds', 'lite')
  AND plan IS NULL;

-- 3. Signups can ask for the bundle, yearly, a referral code and an offer.
ALTER TABLE public.signup_intents
  DROP CONSTRAINT IF EXISTS signup_intents_product_check;
ALTER TABLE public.signup_intents
  ADD CONSTRAINT signup_intents_product_check
  CHECK (product IN ('lite', 'rounds', 'both'));

ALTER TABLE public.signup_intents
  ADD COLUMN IF NOT EXISTS billing_interval text NOT NULL DEFAULT 'month',
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referrer_tenant_id uuid,
  ADD COLUMN IF NOT EXISTS offer text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS last_checkout_at timestamp with time zone;

ALTER TABLE public.signup_intents
  DROP CONSTRAINT IF EXISTS signup_intents_billing_interval_check;
ALTER TABLE public.signup_intents
  ADD CONSTRAINT signup_intents_billing_interval_check
  CHECK (billing_interval IN ('month', 'year'));

ALTER TABLE public.signup_intents
  DROP CONSTRAINT IF EXISTS signup_intents_offer_check;
ALTER TABLE public.signup_intents
  ADD CONSTRAINT signup_intents_offer_check
  CHECK (offer IN ('none', 'founding', 'free_month', 'month_off_year'));

ALTER TABLE public.signup_intents
  DROP CONSTRAINT IF EXISTS signup_intents_referrer_tenant_id_fkey;
ALTER TABLE public.signup_intents
  ADD CONSTRAINT signup_intents_referrer_tenant_id_fkey
  FOREIGN KEY (referrer_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.signup_intents.product IS
  'Plan chosen at signup: rounds | lite | both. (Column name kept from Phase 0.)';
COMMENT ON COLUMN public.signup_intents.billing_interval IS 'month | year.';
COMMENT ON COLUMN public.signup_intents.referral_code IS
  'Referral code the visitor arrived with, already checked as valid when stored.';
COMMENT ON COLUMN public.signup_intents.referrer_tenant_id IS
  'Business whose referral code was used (provisioning creates the referrals row).';
COMMENT ON COLUMN public.signup_intents.offer IS
  'Discount given at Checkout: none | founding | free_month | month_off_year.';
COMMENT ON COLUMN public.signup_intents.last_checkout_at IS
  'When the latest Checkout was opened for this intent (resumed signups). cleanup-signups counts its 7 days from here.';

-- No grant changes: subscriptions keeps its read-own-tenant policy for
-- authenticated users; signup_intents stays service-role only.
