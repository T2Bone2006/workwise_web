-- Pending worker invites: status column, optional postcode until profile is completed
ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS invite_status text NOT NULL DEFAULT 'active'
    CHECK (invite_status IN ('pending', 'active'));

COMMENT ON COLUMN public.workers.invite_status IS 'pending = invited, not yet linked to auth user; active = normal worker record';

ALTER TABLE public.workers
  ALTER COLUMN home_postcode DROP NOT NULL;

-- Called from the mobile app after signInWithPassword to link auth user to the pre-created workers row.
CREATE OR REPLACE FUNCTION public.link_pending_worker_profile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  em text;
  tid uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO em FROM auth.users WHERE id = uid;
  IF em IS NULL OR length(trim(em)) = 0 THEN
    RETURN;
  END IF;

  SELECT (raw_user_meta_data->>'primary_tenant_id')::uuid INTO tid FROM auth.users WHERE id = uid;

  UPDATE public.workers w
  SET
    user_id = uid,
    invite_status = 'active',
    updated_at = now()
  WHERE w.user_id IS NULL
    AND lower(trim(w.email)) = lower(trim(em))
    AND (tid IS NULL OR w.primary_tenant_id = tid);
END;
$$;

REVOKE ALL ON FUNCTION public.link_pending_worker_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_pending_worker_profile() TO authenticated;
