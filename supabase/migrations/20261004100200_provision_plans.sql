-- Phase 7 migration 3: provisioning for rounds | lite | both, monthly or
-- yearly, with a referral code for the new business and the referral row
-- when they signed up with someone's code. Same signature as before.

CREATE OR REPLACE FUNCTION public.provision_tenant_from_intent(
  p_intent_id uuid,
  p_stripe_customer_id text DEFAULT NULL,
  p_stripe_subscription_id text DEFAULT NULL,
  p_stripe_price_id text DEFAULT NULL,
  p_subscription_status text DEFAULT 'active',
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
  v_has_rounds boolean;
  v_has_lite boolean;
  v_product text;
BEGIN
  SELECT * INTO v_intent
  FROM public.signup_intents
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'signup intent % not found', p_intent_id;
  END IF;

  IF v_intent.status = 'provisioned' AND v_intent.tenant_id IS NOT NULL THEN
    RETURN v_intent.tenant_id;
  END IF;

  IF v_intent.product NOT IN ('rounds', 'lite', 'both') THEN
    RAISE EXCEPTION 'signup intent % has unknown plan %', p_intent_id, v_intent.product;
  END IF;

  v_has_rounds := v_intent.product IN ('rounds', 'both');
  v_has_lite   := v_intent.product IN ('lite', 'both');

  -- Slug: business name, then -2, -3 … on collision (unchanged).
  v_base_slug := public.slugify(v_intent.business_name);
  IF v_base_slug = '' THEN
    v_base_slug := 'business';
  END IF;
  v_slug := v_base_slug;
  WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) LOOP
    v_attempt := v_attempt + 1;
    v_slug := v_base_slug || '-' || (v_attempt + 1)::text;
  END LOOP;

  v_settings := jsonb_build_object('features', jsonb_build_object('pro', false));
  IF v_has_rounds THEN
    v_settings := v_settings || jsonb_build_object(
      'rounds', jsonb_build_object(
        'horizon_weeks', 8,
        'reminder_days_before', 3,
        'working_days', jsonb_build_array(1, 2, 3, 4, 5)
      )
    );
  END IF;

  INSERT INTO public.tenants (name, slug, industry, settings, subscription_status, subscription_tier,
                              stripe_customer_id, signup_product, referral_code)
  VALUES (
    v_intent.business_name,
    v_slug,
    nullif(btrim(coalesce(v_intent.trade, '')), ''),
    v_settings,
    'active',
    v_intent.product,
    p_stripe_customer_id,
    v_intent.product,
    public.new_referral_code()
  )
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.users (id, tenant_id, email, full_name, role, is_active)
  VALUES (v_intent.auth_user_id, v_tenant_id, v_intent.email, v_intent.full_name, 'admin', true)
  ON CONFLICT (id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role = 'admin',
        is_active = true;

  IF v_has_rounds THEN
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

  IF v_has_lite THEN
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

  -- One subscriptions row per product the plan unlocks (two for 'both').
  FOREACH v_product IN ARRAY (
    CASE v_intent.product
      WHEN 'both' THEN ARRAY['rounds', 'lite']
      ELSE ARRAY[v_intent.product]
    END
  ) LOOP
    INSERT INTO public.subscriptions (tenant_id, product, status, source, stripe_customer_id,
                                      stripe_subscription_id, stripe_price_id, trial_ends_at,
                                      current_period_end, seats, plan, billing_interval)
    VALUES (
      v_tenant_id,
      v_product,
      coalesce(p_subscription_status, 'active'),
      'stripe',
      p_stripe_customer_id,
      p_stripe_subscription_id,
      p_stripe_price_id,
      p_trial_ends_at,
      p_current_period_end,
      1,
      v_intent.product,
      v_intent.billing_interval
    )
    ON CONFLICT ON CONSTRAINT subscriptions_stripe_sub_product_key DO UPDATE
      SET status = EXCLUDED.status,
          stripe_price_id = EXCLUDED.stripe_price_id,
          trial_ends_at = EXCLUDED.trial_ends_at,
          current_period_end = EXCLUDED.current_period_end,
          plan = EXCLUDED.plan,
          billing_interval = EXCLUDED.billing_interval;
  END LOOP;

  -- The referral, if they came with a valid code (checked when the intent was
  -- written). A referrer deleted since then leaves referrer_tenant_id NULL.
  IF v_intent.referrer_tenant_id IS NOT NULL AND v_intent.referrer_tenant_id <> v_tenant_id THEN
    INSERT INTO public.referrals (referrer_tenant_id, referred_tenant_id, signup_intent_id, code, referee_offer)
    VALUES (
      v_intent.referrer_tenant_id,
      v_tenant_id,
      v_intent.id,
      coalesce(v_intent.referral_code, ''),
      v_intent.offer
    )
    ON CONFLICT ON CONSTRAINT referrals_referred_tenant_key DO NOTHING;
  END IF;

  UPDATE public.signup_intents
  SET status = 'provisioned',
      tenant_id = v_tenant_id,
      stripe_customer_id = coalesce(p_stripe_customer_id, stripe_customer_id),
      provisioned_at = now()
  WHERE id = p_intent_id;

  RETURN v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_tenant_from_intent(uuid, text, text, text, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.provision_tenant_from_intent(uuid, text, text, text, text, timestamptz, timestamptz) IS
  'Phase 7: creates the account for a paid signup (rounds | lite | both, month | year) in one transaction. Idempotent per intent. Service role only.';
