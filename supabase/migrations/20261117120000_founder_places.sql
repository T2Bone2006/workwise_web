-- The 200 founder places: 50% off for life for the first 200 businesses.
--
-- One place per business, shared by Rounds, Lite and the bundle. A place is claimed when the free
-- trial starts and given back if the business cancels during the trial. A Stripe coupon cannot
-- hand a use back, so we count them ourselves.
--
-- Only the server (service role) touches this. Nothing here is readable from the browser.
-- Safe to paste twice.

CREATE TABLE IF NOT EXISTS public.founder_places (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  stripe_subscription_id text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  release_reason text
);

COMMENT ON TABLE public.founder_places IS
  'One row per business that holds (or held) a founder place. released_at set = the place went back to the pool (cancelled during the trial).';

CREATE INDEX IF NOT EXISTS founder_places_live_idx
  ON public.founder_places (tenant_id) WHERE released_at IS NULL;

ALTER TABLE public.founder_places ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.founder_places FROM anon, authenticated;

-- How many places are in use right now.
CREATE OR REPLACE FUNCTION public.founder_places_taken()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer FROM public.founder_places WHERE released_at IS NULL;
$$;

-- Claim a place for a business. Returns 'claimed', 'already' (this business already holds one),
-- 'used' (it held one before and gave it back: no second go) or 'full' (all places are taken).
-- The advisory lock makes two people finishing at the same moment take turns, so place 201 is never given out.
CREATE OR REPLACE FUNCTION public.claim_founder_place(
  p_tenant_id uuid,
  p_subscription_id text,
  p_limit integer DEFAULT 200
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing public.founder_places%ROWTYPE;
  taken integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('founder_places'));

  SELECT * INTO existing FROM public.founder_places WHERE tenant_id = p_tenant_id;
  IF FOUND THEN
    IF existing.released_at IS NULL THEN
      RETURN 'already';
    END IF;
    RETURN 'used';
  END IF;

  SELECT count(*) INTO taken FROM public.founder_places WHERE released_at IS NULL;
  IF taken >= p_limit THEN
    RETURN 'full';
  END IF;

  INSERT INTO public.founder_places (tenant_id, stripe_subscription_id)
  VALUES (p_tenant_id, p_subscription_id);
  RETURN 'claimed';
END;
$$;

-- Give a place back. Returns true when a live place was released, false when there was nothing to release.
CREATE OR REPLACE FUNCTION public.release_founder_place(p_tenant_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('founder_places'));
  UPDATE public.founder_places
     SET released_at = now(), release_reason = left(coalesce(p_reason, ''), 200)
   WHERE tenant_id = p_tenant_id AND released_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.founder_places_taken() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_founder_place(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_founder_place(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.founder_places_taken() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_founder_place(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_founder_place(uuid, text) TO service_role;

-- Place 1 of 200: Anglesey Windows, the first real customer. This only COUNTS them, so the pool starts at 199 left.
-- Their Stripe subscription is not touched (they stay on their own flat price) and no coupon is attached.
-- Skipped quietly if that business is not in this database, and safe to paste twice.
INSERT INTO public.founder_places (tenant_id, stripe_subscription_id)
SELECT t.id, 'sub_1URF4v2OaXeIQQdAu7iboz2u'
FROM public.tenants t
WHERE t.id = 'a3855757-aeb8-401c-a10a-3352aff0ed86'
ON CONFLICT (tenant_id) DO NOTHING;
