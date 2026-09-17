-- Self-serve signup plumbing.
--
-- signup_intents: one row per person who started signup. Created before
-- Stripe Checkout, so the auth user + what they asked for is known before any
-- money moves. status flips to 'provisioned' inside the provisioning
-- function; 'abandoned' is set by a cleanup cron after 7 days.
--
-- stripe_events: insert-first idempotency for the Stripe webhook. The event
-- id is the primary key, so a redelivered event hits a conflict and is
-- acknowledged without being processed twice.
--
-- provision_tenant_from_intent(): creates the whole account in ONE
-- transaction — tenant, dashboard login, (for Rounds) the worker record that
-- the mobile app looks up, its worker_tenants membership, (for Lite) the
-- widget client, and the subscription row. PostgREST calls are not
-- transactional, so doing this in SQL is what prevents a half-made account
-- (a tenant with no users row is the worst outcome of a webhook retry).
-- SECURITY DEFINER because it is called by the service role from the webhook
-- and inserts across tables with different RLS shapes.

CREATE TABLE IF NOT EXISTS public.signup_intents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL,
  email text NOT NULL,
  product text NOT NULL,
  business_name text NOT NULL,
  full_name text NOT NULL,
  phone text,
  postcode text,
  -- Lite only: what the chatbot says the business does.
  trade text,
  stripe_customer_id text,
  stripe_checkout_session_id text,
  status text NOT NULL DEFAULT 'pending',
  tenant_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  provisioned_at timestamp with time zone,
  CONSTRAINT signup_intents_pkey PRIMARY KEY (id),
  CONSTRAINT signup_intents_auth_user_id_key UNIQUE (auth_user_id),
  CONSTRAINT signup_intents_auth_user_id_fkey FOREIGN KEY (auth_user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT signup_intents_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE SET NULL,
  CONSTRAINT signup_intents_stripe_checkout_session_id_key UNIQUE (stripe_checkout_session_id),
  CONSTRAINT signup_intents_product_check CHECK (product IN ('lite', 'rounds')),
  CONSTRAINT signup_intents_status_check CHECK (
    status IN ('pending', 'provisioned', 'abandoned')
  )
);

COMMENT ON TABLE public.signup_intents IS
  'A started self-serve signup. Anchors provisioning idempotency; service-role only.';

CREATE INDEX IF NOT EXISTS idx_signup_intents_status_created
  ON public.signup_intents (status, created_at);

CREATE TABLE IF NOT EXISTS public.stripe_events (
  id text NOT NULL,
  type text NOT NULL,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  error text,
  CONSTRAINT stripe_events_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.stripe_events IS
  'Every Stripe webhook event seen, keyed by Stripe event id. Insert-first idempotency.';

-- Service-role only: RLS on with no policies for authenticated.
ALTER TABLE public.signup_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

-- Slug helper: "Dave's Window Cleaning" -> "daves-window-cleaning".
CREATE OR REPLACE FUNCTION public.slugify(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' FROM regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.provision_tenant_from_intent(
  p_intent_id uuid,
  p_stripe_customer_id text DEFAULT NULL,
  p_stripe_subscription_id text DEFAULT NULL,
  p_stripe_price_id text DEFAULT NULL,
  p_subscription_status text DEFAULT 'trialing',
  p_trial_ends_at timestamp with time zone DEFAULT NULL,
  p_current_period_end timestamp with time zone DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent public.signup_intents%ROWTYPE;
  v_tenant_id uuid;
  v_worker_id uuid;
  v_base_slug text;
  v_slug text;
  v_attempt integer := 0;
  v_settings jsonb;
BEGIN
  SELECT * INTO v_intent
  FROM public.signup_intents
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'signup intent % not found', p_intent_id;
  END IF;

  -- Idempotent: a webhook retry after a successful run returns the same tenant.
  IF v_intent.status = 'provisioned' AND v_intent.tenant_id IS NOT NULL THEN
    RETURN v_intent.tenant_id;
  END IF;

  -- Unique slug: base, then base-2, base-3, ...
  v_base_slug := public.slugify(v_intent.business_name);
  IF v_base_slug = '' THEN
    v_base_slug := 'business';
  END IF;
  v_slug := v_base_slug;
  WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) LOOP
    v_attempt := v_attempt + 1;
    v_slug := v_base_slug || '-' || (v_attempt + 1)::text;
  END LOOP;

  -- Explicit features.pro=false so the legacy settings fallback can never
  -- treat a self-serve tenant as Pro.
  v_settings := jsonb_build_object('features', jsonb_build_object('pro', false));
  IF v_intent.product = 'rounds' THEN
    v_settings := v_settings || jsonb_build_object(
      'rounds', jsonb_build_object(
        'horizon_weeks', 8,
        'reminder_days_before', 3,
        'working_days', jsonb_build_array(1, 2, 3, 4, 5)
      )
    );
  END IF;

  INSERT INTO public.tenants (name, slug, industry, settings, subscription_status, subscription_tier,
                              stripe_customer_id, signup_product)
  VALUES (
    v_intent.business_name,
    v_slug,
    CASE WHEN v_intent.product = 'rounds' THEN 'Rounds' ELSE v_intent.trade END,
    v_settings,
    'active',
    v_intent.product,
    p_stripe_customer_id,
    v_intent.product
  )
  RETURNING id INTO v_tenant_id;

  -- Dashboard login. Role stays 'admin': RLS policies (worker_tenants and
  -- others) key on that exact string.
  INSERT INTO public.users (id, tenant_id, email, full_name, role, is_active)
  VALUES (v_intent.auth_user_id, v_tenant_id, v_intent.email, v_intent.full_name, 'admin', true)
  ON CONFLICT (id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role = 'admin',
        is_active = true;

  -- Rounds owners do their own jobs, so they are also a worker: the mobile
  -- app finds them via workers.user_id = auth.uid().
  IF v_intent.product = 'rounds' THEN
    INSERT INTO public.workers (user_id, full_name, phone, email, worker_type, primary_tenant_id,
                                home_postcode, invite_status, status)
    VALUES (
      v_intent.auth_user_id,
      v_intent.full_name,
      coalesce(v_intent.phone, ''),
      v_intent.email,
      'platform_solo',
      v_tenant_id,
      v_intent.postcode,
      'active',
      'available'
    )
    RETURNING id INTO v_worker_id;

    INSERT INTO public.worker_tenants (worker_id, tenant_id, status, is_primary)
    VALUES (v_worker_id, v_tenant_id, 'active', true);
  END IF;

  -- Lite gets its chatbot client row straight away so the script tag can be
  -- issued; pricing/business context are filled in later from the dashboard.
  IF v_intent.product = 'lite' THEN
    INSERT INTO public.widget_clients (tenant_id, business_name, trade, service_area, notification_email,
                                       allowed_domains, active)
    VALUES (
      v_tenant_id,
      v_intent.business_name,
      coalesce(nullif(v_intent.trade, ''), 'Trade services'),
      coalesce(nullif(v_intent.postcode, ''), 'UK'),
      v_intent.email,
      '{}'::text[],
      true
    );
  END IF;

  INSERT INTO public.subscriptions (tenant_id, product, status, source, stripe_customer_id,
                                    stripe_subscription_id, stripe_price_id, trial_ends_at,
                                    current_period_end, seats)
  VALUES (
    v_tenant_id,
    v_intent.product,
    coalesce(p_subscription_status, 'trialing'),
    'stripe',
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_stripe_price_id,
    p_trial_ends_at,
    p_current_period_end,
    1
  )
  ON CONFLICT (stripe_subscription_id) DO UPDATE
    SET status = EXCLUDED.status,
        stripe_price_id = EXCLUDED.stripe_price_id,
        trial_ends_at = EXCLUDED.trial_ends_at,
        current_period_end = EXCLUDED.current_period_end;

  UPDATE public.signup_intents
  SET status = 'provisioned',
      tenant_id = v_tenant_id,
      stripe_customer_id = coalesce(p_stripe_customer_id, stripe_customer_id),
      provisioned_at = now()
  WHERE id = p_intent_id;

  RETURN v_tenant_id;
END;
$$;

COMMENT ON FUNCTION public.provision_tenant_from_intent IS
  'Creates tenant + login + (rounds) worker + (lite) widget client + subscription atomically. Idempotent per intent.';

-- Only the service role may call it.
REVOKE ALL ON FUNCTION public.provision_tenant_from_intent(uuid, text, text, text, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
