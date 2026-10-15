-- Phase 9 (Rounds team), file 3 of 3. Paste after 20261011100000 and 20261011100100.
-- Spec: docs/specs/phase-9/05-migration-staff-access.md
--
-- What this does: closes the database to a Rounds member of staff (a "lead": a login in the owner's business,
-- users.role = 'worker', with a team_people row). Such a login can read only the visits assigned to it and the
-- customers on those visits, and can write nothing directly. Money, settings, books and everyone else's work are
-- refused, even if someone bypassed the app and called the database with the login's own token.
--
-- Why it is built this way:
--   * Many existing rules say only "same business as the login" (customers, invoices, payments, rounds, ...),
--     which a staff login satisfies. Dropping or editing them would risk Pro employees and the owner.
--   * So every rule here is RESTRICTIVE: Postgres ANDs restrictive policies with the existing permissive ones. They
--     only bite when public.is_rounds_staff() is true. Owners, Pro employees, accountants, portal customers and the
--     service role are untouched (the service role skips row security altogether; the staff API uses it).
--   * Written against the LIVE policies the owner pasted on 2026-10-10 (Queries A, B, C), not the stale snapshot.
--
-- Differences from the card, on purpose:
--   * is_rounds_staff() stays true for a lead who has been REMOVED (ended / deactivated) as long as their login still
--     sits in the business they worked for. Removing a lead bans the login, but a token already issued keeps working
--     until it expires; with the card's definition that token would regain the wide "same business" read rules for
--     up to an hour. A former lead who later starts their OWN business is not caught: their users row is then an
--     admin of a different business.
--   * password_resets and ai_interactions are in the deny list too (both have wide rules in the live policies).
--   * Policies call (SELECT public.is_rounds_staff()) so Postgres evaluates it once per query, not once per row.
--
-- Never enables row security on a table that has it off (that would lock the owner out): such a table is skipped
-- with a NOTICE. Nothing existing is dropped; the only DROP POLICY lines are our own *_no_rounds_staff_* names.
-- Safe to paste twice.
--
-- Known side effects for a Rounds lead (intended, v1):
--   * The phone's "save my push token" write to workers is refused (it only logs a warning; staff get no pushes in v1).
--   * They cannot read tenant_skills or write job attachments / job history directly.
--   * They can read their own business row in tenants (name and settings; the phone needs it).
--
-- To undo (history only; this is not run by the app):
--   DO $u$ DECLARE r record; BEGIN
--     FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
--              WHERE schemaname = 'public' AND policyname LIKE '%\_no\_rounds\_staff\_%'
--     LOOP EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename); END LOOP; END $u$;
--   DROP FUNCTION IF EXISTS public.is_rounds_staff();
--   DROP FUNCTION IF EXISTS public.my_worker_ids();

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers

-- True for the signed-in login when it is a member of staff on someone else's Rounds team (current or former).
-- False for owners (role 'admin'), Pro employees (no team_people row), accountants and portal customers.
CREATE OR REPLACE FUNCTION public.is_rounds_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.workers w ON w.user_id = u.id
    JOIN public.team_people tp ON tp.worker_id = w.id AND tp.tenant_id = u.tenant_id
    WHERE u.id = auth.uid()
      AND u.role IS DISTINCT FROM 'admin'
      AND tp.kind = 'lead'
  );
$$;

REVOKE ALL ON FUNCTION public.is_rounds_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_rounds_staff() TO authenticated;

COMMENT ON FUNCTION public.is_rounds_staff() IS
  'Phase 9: true when the signed-in login is (or was) a lead on a Rounds team in the business its users row belongs to. Used by the *_no_rounds_staff_* restrictive policies.';

-- The signed-in login's own worker rows.
CREATE OR REPLACE FUNCTION public.my_worker_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.workers WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.my_worker_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_worker_ids() TO authenticated;

COMMENT ON FUNCTION public.my_worker_ids() IS
  'Phase 9: the signed-in login''s own workers rows (bypasses row security so policies can use it without recursion).';

-- ---------------------------------------------------------------------------
-- 1. Deny list: staff may neither read nor write these tables at all.

DO $$
DECLARE
  t text;
  deny constant text[] := ARRAY[
    'payments', 'payment_allocations', 'invoices', 'invoice_lines', 'expenses',
    'accountant_access', 'accountant_login_codes', 'accountant_sessions',
    'service_agreements', 'service_catalog', 'service_presets', 'tenant_payment_settings',
    'message_threads', 'messages', 'messaging_opt_outs', 'messaging_inbound_limits', 'messaging_unrouted_inbound',
    'tenant_text_balance', 'text_pack_purchases', 'visit_changes', 'customer_charges', 'owner_pushes',
    'gocardless_connections', 'gocardless_events', 'customer_direct_debits', 'direct_debit_collections',
    'gocardless_mandate_links', 'gocardless_pay_requests',
    'setup_requests', 'subscriptions', 'signup_intents', 'referrals',
    'assistant_conversations', 'assistant_messages', 'assistant_actions',
    'rounds', 'import_sources', 'import_history', 'job_groups',
    'widget_clients', 'widget_conversations', 'widget_usage_daily',
    'leads', 'lead_action_tokens', 'lite_interviews', 'lite_price_profiles', 'lite_texts',
    'team_people', 'work_days', 'team_payments', 'team_days_off',
    'worker_allowance_confirmations', 'tenant_skills', 'tenant_network_connections', 'network_job_dispatches',
    'customer_invites', 'customer_portal_users', 'worker_invites',
    'password_resets', 'ai_interactions'
  ];
  rls_on boolean;
BEGIN
  FOREACH t IN ARRAY deny LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE; -- a later phase's table: nothing to do yet
    END IF;

    SELECT c.relrowsecurity INTO rls_on
    FROM pg_class c
    WHERE c.oid = to_regclass(format('public.%I', t));

    IF NOT rls_on THEN
      RAISE NOTICE 'SKIPPED % : row security is OFF on this table, so these rules would do nothing. Tell Claude.', t;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_no_rounds_staff_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT (SELECT public.is_rounds_staff()))',
      t || '_no_rounds_staff_read', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_no_rounds_staff_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT (SELECT public.is_rounds_staff()))',
      t || '_no_rounds_staff_write', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_no_rounds_staff_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT (SELECT public.is_rounds_staff())) WITH CHECK (NOT (SELECT public.is_rounds_staff()))',
      t || '_no_rounds_staff_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_no_rounds_staff_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT (SELECT public.is_rounds_staff()))',
      t || '_no_rounds_staff_delete', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Allowed but narrowed: staff may read only what concerns their own visits (or their own row).
--    Reads are narrowed table by table below; writes are blocked for all eight in the loop at the end.

-- jobs: only visits assigned to one of their own worker rows (the existing rule also hides undispatched visits).
DROP POLICY IF EXISTS "jobs_no_rounds_staff_read" ON public.jobs;
CREATE POLICY "jobs_no_rounds_staff_read" ON public.jobs
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_rounds_staff()) OR assigned_worker_id IN (SELECT public.my_worker_ids()));

-- customers: only the customers on those visits.
DROP POLICY IF EXISTS "customers_no_rounds_staff_read" ON public.customers;
CREATE POLICY "customers_no_rounds_staff_read" ON public.customers
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT (SELECT public.is_rounds_staff())
    OR id IN (SELECT j.customer_id FROM public.jobs j WHERE j.assigned_worker_id IN (SELECT public.my_worker_ids()))
  );

-- job_attachments, job_status_history: only for those visits.
DROP POLICY IF EXISTS "job_attachments_no_rounds_staff_read" ON public.job_attachments;
CREATE POLICY "job_attachments_no_rounds_staff_read" ON public.job_attachments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT (SELECT public.is_rounds_staff())
    OR job_id IN (SELECT j.id FROM public.jobs j WHERE j.assigned_worker_id IN (SELECT public.my_worker_ids()))
  );

DROP POLICY IF EXISTS "job_status_history_no_rounds_staff_read" ON public.job_status_history;
CREATE POLICY "job_status_history_no_rounds_staff_read" ON public.job_status_history
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT (SELECT public.is_rounds_staff())
    OR job_id IN (SELECT j.id FROM public.jobs j WHERE j.assigned_worker_id IN (SELECT public.my_worker_ids()))
  );

-- tenants: only their own business row.
DROP POLICY IF EXISTS "tenants_no_rounds_staff_read" ON public.tenants;
CREATE POLICY "tenants_no_rounds_staff_read" ON public.tenants
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT (SELECT public.is_rounds_staff())
    OR id IN (SELECT u.tenant_id FROM public.users u WHERE u.id = (SELECT auth.uid()))
  );

-- workers, worker_tenants, users: only their own rows (no colleagues, no owner).
DROP POLICY IF EXISTS "workers_no_rounds_staff_read" ON public.workers;
CREATE POLICY "workers_no_rounds_staff_read" ON public.workers
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_rounds_staff()) OR user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "worker_tenants_no_rounds_staff_read" ON public.worker_tenants;
CREATE POLICY "worker_tenants_no_rounds_staff_read" ON public.worker_tenants
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_rounds_staff()) OR worker_id IN (SELECT public.my_worker_ids()));

DROP POLICY IF EXISTS "users_no_rounds_staff_read" ON public.users;
CREATE POLICY "users_no_rounds_staff_read" ON public.users
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (SELECT public.is_rounds_staff()) OR id = (SELECT auth.uid()));

-- Writes on those eight tables: staff change things only through the staff API (service role).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['jobs', 'customers', 'job_attachments', 'job_status_history', 'tenants', 'workers', 'worker_tenants', 'users'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_no_rounds_staff_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT (SELECT public.is_rounds_staff()))',
      t || '_no_rounds_staff_write', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_no_rounds_staff_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT (SELECT public.is_rounds_staff())) WITH CHECK (NOT (SELECT public.is_rounds_staff()))',
      t || '_no_rounds_staff_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_no_rounds_staff_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT (SELECT public.is_rounds_staff()))',
      t || '_no_rounds_staff_delete', t);
  END LOOP;
END
$$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Checks (run one at a time after pasting; they change nothing)
--
-- (a) How many staff rules exist. Expected 272 (68 tables x 4: 60 deny-list + 8 narrowed). A lower number means the
--     paste printed "SKIPPED ..." notices; send them to Claude.
--       SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE '%\_no\_rounds\_staff\_%';
--
-- (b) The owner is not staff (in the SQL editor there is no login, so this is always false):
--       SELECT public.is_rounds_staff();
--
-- (c) See the database as a real lead would (replace the id with the lead's users.id; run all lines together).
--     Expected: payments 0, expenses 0, customers = only customers on their visits, jobs = only their visits.
--       BEGIN;
--       SET LOCAL ROLE authenticated;
--       SELECT set_config('request.jwt.claims', json_build_object('sub', '<LEAD USERS.ID>', 'role', 'authenticated')::text, true);
--       SELECT public.is_rounds_staff() AS is_staff,
--              (SELECT count(*) FROM public.payments) AS payments,
--              (SELECT count(*) FROM public.expenses) AS expenses,
--              (SELECT count(*) FROM public.customers) AS customers,
--              (SELECT count(*) FROM public.jobs) AS jobs,
--              (SELECT count(*) FROM public.workers) AS workers;
--       ROLLBACK;
--
-- (d) The same for a Pro employee or the owner must give their usual numbers and is_staff = false.
