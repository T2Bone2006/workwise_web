-- Security fix, found 2026-10-10 in the live policies the owner pasted for Phase 9 step 2.
-- Independent of Phase 9: paste it any time (the sooner the better), in one go.
--
-- REVISED 2026-10-10: the first version of this file made customers and jobs fail with "infinite recursion detected
-- in policy for relation customers" (see the IMPORTANT note below). This version fixes that. If you pasted the first
-- version, paste this one again over it: it is safe to paste twice and replaces the two rules that caused it.
--
-- The problem: three tables each had a rule named "Service role can manage ..." with command ALL, role public and
-- a test of plain `true`. That is not limited to the service role (the service role skips row security anyway):
-- it lets ANYONE holding the public anon key read, add, change and delete every row.
--   password_resets       reset tokens are stored as plain text, so anyone could read one and take over an account
--   customer_invites      the same for portal-invite tokens
--   customer_portal_users anyone could link themselves to any customer and read that customer's visits
--
-- What this does:
--   1. Drops those three open rules. The server code only ever uses the service role on password_resets and
--      customer_invites, and customer_invites already has proper per-business rules for a logged-in owner.
--   2. customer_portal_users: the owner's dashboard reads (and, when closing a customer, deletes) these rows with
--      the owner's own login and only worked because of the open rule. They get proper per-business rules instead:
--      a business can see its own customers' portal links, and an admin of it can remove them. A portal customer
--      keeps reading their own row ("Portal users can read own rows", untouched). Adding rows stays server-only.
--   3. Takes the anon role's table access away from password_resets and customer_invites, as a second lock.
--
-- Nothing is dropped except the three named rules. Safe to paste twice.
--
-- To undo (history only; do not run it, it reopens the hole):
--   CREATE POLICY "Service role can manage password_resets" ON public.password_resets USING (true) WITH CHECK (true);
--   (and the same for customer_invites and customer_portal_users); GRANT ALL ON them TO anon;

BEGIN;

DROP POLICY IF EXISTS "Service role can manage password_resets" ON public.password_resets;
DROP POLICY IF EXISTS "Service role can manage customer_invites" ON public.customer_invites;
DROP POLICY IF EXISTS "Service role can manage customer_portal_users" ON public.customer_portal_users;

-- Own business's portal links (read) and removal by an admin of that business.
--
-- IMPORTANT: these rules must NOT look at public.customers directly. customers has a rule that looks at
-- customer_portal_users ("Portal users can read own customer"), so a rule here that looked back at customers
-- made Postgres chase its own tail ("infinite recursion detected in policy for relation customers") and every
-- page that read customers or jobs failed. The two lookup functions below run with their own rights, which cuts
-- the loop (the same pattern as current_worker_customer_ids() in 20261008100100).
CREATE OR REPLACE FUNCTION public.current_tenant_customer_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.customers c
  WHERE c.tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.current_admin_tenant_customer_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM public.customers c
  WHERE c.tenant_id IN (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin');
$$;

REVOKE ALL ON FUNCTION public.current_tenant_customer_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_admin_tenant_customer_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_customer_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_admin_tenant_customer_ids() TO authenticated;

DROP POLICY IF EXISTS "customer_portal_users_tenant_select" ON public.customer_portal_users;
CREATE POLICY "customer_portal_users_tenant_select" ON public.customer_portal_users
  FOR SELECT TO authenticated
  USING (customer_id IN (SELECT public.current_tenant_customer_ids()));

DROP POLICY IF EXISTS "customer_portal_users_admin_delete" ON public.customer_portal_users;
CREATE POLICY "customer_portal_users_admin_delete" ON public.customer_portal_users
  FOR DELETE TO authenticated
  USING (customer_id IN (SELECT public.current_admin_tenant_customer_ids()));

-- Second lock: nobody without a login ever needs these two tables.
REVOKE ALL ON public.password_resets FROM anon;
REVOKE ALL ON public.customer_invites FROM anon;

-- customer_portal_users is NOT locked this way: other tables' rules ("Portal users can read own customer", "Portal
-- users can read own jobs") look inside it, and a logged-out visitor's read of customers or jobs would then fail
-- with "permission denied" instead of simply finding nothing. Row security already shows a logged-out visitor no
-- rows of it. The first version of this file revoked it; this puts the access back (harmless: no rule lets anon in).
GRANT ALL ON public.customer_portal_users TO anon;

COMMIT;

-- ---------------------------------------------------------------------------
-- Checks (run one at a time; they change nothing)
--
-- (a) The open rules are gone. Expected: no rows.
--       SELECT tablename, policyname FROM pg_policies
--       WHERE schemaname = 'public' AND policyname LIKE 'Service role can manage%';
--       (This may list other tables' rules of that name; none may be password_resets, customer_invites or
--        customer_portal_users.)
--
-- (b) Someone without a login is refused. Expected: ERROR "permission denied for table password_resets".
--       BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.password_resets; ROLLBACK;
--
-- Optional, if you want to be thorough: any reset link or invite that was sitting unused while the hole was open
-- could in theory have been read. Clearing them only makes people ask for a fresh link:
--       DELETE FROM public.password_resets;
--       DELETE FROM public.customer_invites WHERE used_at IS NULL;
