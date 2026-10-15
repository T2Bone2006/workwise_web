-- Worker web area, migration 3: accept a business invite.
--
-- Turns an unused kind='business' worker invite into the worker's own
-- business: a new tenant, the login moved to it as its admin, the employer link
-- (the workers row) kept, the invite marked used. One transaction, safe to call
-- twice with the same token. Service role only (the confirm route calls it).
--
-- Needs migration 1 (worker_invites.kind, tenants.worker_discount_worker_id).
--
-- No subscription, Stripe customer or widget_clients row is created here: those
-- appear when the worker buys Lite. The new business is created with
-- settings.features.pro = false, because getTenantProducts() treats a business
-- with no subscription rows as Pro unless that flag says otherwise.

CREATE OR REPLACE FUNCTION public.accept_business_worker_invite(
  p_token uuid,
  p_business_name text,
  p_trade text DEFAULT NULL,
  p_postcode text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_invite public.worker_invites%ROWTYPE;
  v_worker public.workers%ROWTYPE;
  v_tenant_id uuid;
  v_base_slug text;
  v_slug text;
  v_attempt integer := 0;
BEGIN
  v_name := btrim(coalesce(p_business_name, ''));
  IF char_length(v_name) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'business_name_invalid';
  END IF;

  SELECT * INTO v_invite
  FROM public.worker_invites
  WHERE token = p_token AND kind = 'business'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = v_invite.worker_id;

  IF NOT FOUND
     OR v_worker.user_id IS NULL
     OR v_worker.primary_tenant_id IS DISTINCT FROM v_invite.tenant_id
     OR coalesce(v_worker.invite_status, '') = 'deactivated' THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  -- Replay: this worker already has a business from this link. Make sure the
  -- invite is burned and hand back the same tenant.
  SELECT id INTO v_tenant_id
  FROM public.tenants
  WHERE worker_discount_worker_id = v_worker.id
  ORDER BY created_at
  LIMIT 1;

  IF v_tenant_id IS NOT NULL THEN
    UPDATE public.worker_invites
    SET used_at = coalesce(used_at, now())
    WHERE id = v_invite.id;
    RETURN v_tenant_id;
  END IF;

  IF v_invite.used_at IS NOT NULL OR v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'invite_invalid';
  END IF;

  -- Slug: business name, then -2, -3 ... on collision (same loop as provisioning).
  v_base_slug := public.slugify(v_name);
  IF v_base_slug = '' THEN
    v_base_slug := 'business';
  END IF;
  v_slug := v_base_slug;
  WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) LOOP
    v_attempt := v_attempt + 1;
    v_slug := v_base_slug || '-' || (v_attempt + 1)::text;
  END LOOP;

  INSERT INTO public.tenants (name, slug, industry, settings, subscription_status,
                              referral_code, worker_discount_worker_id)
  VALUES (
    v_name,
    v_slug,
    nullif(btrim(coalesce(p_trade, '')), ''),
    jsonb_build_object('features', jsonb_build_object('pro', false)),
    'active',
    public.new_referral_code(),
    v_worker.id
  )
  RETURNING id INTO v_tenant_id;

  -- The login moves to its own business as admin. The employer link is the
  -- workers row (primary_tenant_id stays the employer), so nothing is lost.
  INSERT INTO public.users (id, tenant_id, email, full_name, role, is_active)
  VALUES (v_worker.user_id, v_tenant_id, v_invite.email, v_worker.full_name, 'admin', true)
  ON CONFLICT (id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role = 'admin',
        is_active = true;

  UPDATE public.workers
  SET invite_status = 'accepted', updated_at = now()
  WHERE id = v_worker.id;

  UPDATE public.worker_invites
  SET used_at = now()
  WHERE id = v_invite.id;

  RETURN v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_business_worker_invite(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.accept_business_worker_invite(uuid, text, text, text) IS
  'Worker web area: turns an unused kind=business worker invite into the worker''s own business. Idempotent. Service role only.';
