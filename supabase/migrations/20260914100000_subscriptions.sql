-- Subscriptions: what each tenant has paid for (or been granted).
--
-- Replaces the ad hoc tenants.settings.features.pro flag as the source of
-- truth for product access. One row per live product per tenant; a tenant can
-- hold several (e.g. lite + rounds). Pro tiers (starter/growth/pro) are
-- mutually exclusive in practice but the schema doesn't enforce that yet —
-- Pro self-serve is a later phase.
--
-- Rows are written only by the service role (Stripe webhook, provisioning
-- function, platform-admin grants). Authenticated users, including workers,
-- may read their own tenant's rows: the mobile app needs to know which tab
-- set to show, and "this tenant has Rounds" is not sensitive.
--
-- Existing tenants get a manual 'pro' row in the backfill migration that
-- follows; until that has run, lib/data/tenant-products.ts falls back to the
-- legacy settings flag so nobody loses their sidebar.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product text NOT NULL,
  -- Mirrors Stripe's subscription status so page loads never call Stripe.
  -- 'manual' = granted by WorkWise, no Stripe subscription behind it.
  status text NOT NULL,
  source text NOT NULL DEFAULT 'stripe',
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  trial_ends_at timestamp with time zone,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamp with time zone,
  -- Included workers for Pro tiers; 1 for lite/rounds.
  seats integer NOT NULL DEFAULT 1,
  granted_by_user_id uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT subscriptions_granted_by_user_id_fkey FOREIGN KEY (granted_by_user_id)
    REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id),
  CONSTRAINT subscriptions_product_check CHECK (
    product IN ('lite', 'rounds', 'starter', 'growth', 'pro')
  ),
  CONSTRAINT subscriptions_status_check CHECK (
    status IN (
      'trialing', 'active', 'past_due', 'canceled', 'unpaid',
      'incomplete', 'incomplete_expired', 'paused', 'manual'
    )
  ),
  CONSTRAINT subscriptions_source_check CHECK (source IN ('stripe', 'manual')),
  CONSTRAINT subscriptions_seats_check CHECK (seats >= 1)
);

COMMENT ON TABLE public.subscriptions IS
  'Product entitlements per tenant. Source of truth for what the dashboard and app show.';
COMMENT ON COLUMN public.subscriptions.status IS
  'Stripe subscription status, or ''manual'' for WorkWise-granted access. Entitled = trialing | active | past_due | manual.';

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id
  ON public.subscriptions (tenant_id);

-- At most one live subscription per product per tenant. Cancelled rows are
-- kept for history and don't block re-subscribing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_live_product
  ON public.subscriptions (tenant_id, product)
  WHERE status IN ('trialing', 'active', 'past_due', 'manual');

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id
  ON public.subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Generic updated_at helper (idempotent; safe if it already exists under this name).
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Stripe identifiers on the tenant. One Stripe customer per tenant (it may
-- hold several subscriptions); one Connect account per tenant for Rounds
-- card payments.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarded_at timestamp with time zone,
  -- Which product the tenant originally signed up for (null for hand-provisioned tenants).
  ADD COLUMN IF NOT EXISTS signup_product text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_stripe_customer_id
  ON public.tenants (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_stripe_connect_account_id
  ON public.tenants (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

-- RLS: read-only for the tenant's own logins (any role); no write policies,
-- so only the service role can insert/update/delete.
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_tenant_select" ON public.subscriptions;

CREATE POLICY "subscriptions_tenant_select"
ON public.subscriptions FOR SELECT
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
  OR tenant_id IN (
    -- Workers whose users row points elsewhere (or is missing) still need to
    -- resolve their primary tenant's products in the mobile app.
    SELECT primary_tenant_id FROM public.workers WHERE user_id = auth.uid()
  )
);
