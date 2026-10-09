-- Phase 8 migration 1: Pro self-serve.
--
-- A business can now sign up for Starter, Growth or Pro (monthly or yearly)
-- on its own sign-up page. This widens two CHECK constraints and adds the
-- worker number the visitor chose on the pricing slider. Nothing existing
-- changes: no row is updated, and RS Locksmiths / Eden are not touched.
-- Safe to paste twice.

-- 1. A signup intent can be for a Pro tier.
ALTER TABLE public.signup_intents
  DROP CONSTRAINT IF EXISTS signup_intents_product_check;
ALTER TABLE public.signup_intents
  ADD CONSTRAINT signup_intents_product_check
  CHECK (product IN ('lite', 'rounds', 'both', 'starter', 'growth', 'pro'));

COMMENT ON COLUMN public.signup_intents.product IS
  'Plan chosen at signup: rounds | lite | both | starter | growth | pro. (Column name kept from Phase 0.)';

-- 2. The worker number from the pricing slider (advice only; billing follows the real team).
ALTER TABLE public.signup_intents
  ADD COLUMN IF NOT EXISTS expected_workers integer;

ALTER TABLE public.signup_intents
  DROP CONSTRAINT IF EXISTS signup_intents_expected_workers_check;
ALTER TABLE public.signup_intents
  ADD CONSTRAINT signup_intents_expected_workers_check
  CHECK (expected_workers IS NULL OR (expected_workers >= 0 AND expected_workers <= 999));

COMMENT ON COLUMN public.signup_intents.expected_workers IS
  'Pro only: how many workers the visitor said they have (pricing slider). Copied to tenants.settings.onboarding.expected_workers when the account is made. Never used for billing.';

-- 3. subscriptions.plan can hold a Pro tier name.
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IS NULL OR plan IN ('rounds', 'lite', 'both', 'starter', 'growth', 'pro'));

COMMENT ON COLUMN public.subscriptions.plan IS
  'Self-serve plan bought: rounds | lite | both (the bundle writes a rounds row and a lite row), or starter | growth | pro for a self-serve Pro business. NULL for manual rows.';

-- No grant or policy changes: signup_intents stays service-role only and
-- subscriptions keeps its read-own-tenant policy.
