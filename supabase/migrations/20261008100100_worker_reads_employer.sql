-- Worker web area, migration 2: a worker whose login belongs to their OWN business can still
-- read the employer data the phone and the worker area need for the jobs given to them.
--
-- Written against the LIVE policies (pasted by the owner, 2026-10-08), not the stale snapshot
-- in supabase/rls policies. What the live rules already allow for a login whose
-- users.tenant_id is a different business (so nothing is added for these):
--   - tenants SELECT        "Workers can read their own tenant" (any login with a workers row for it)
--   - jobs SELECT / UPDATE   by assigned worker (branches B and C), not by business
--   - job_attachments INSERT only checks uploaded_by_worker_id is your worker row
--   - storage job-attachments  any authenticated login (pre-existing: very wide, see the note below)
--   - workers / worker_tenants SELECT own rows
-- What stops working when the login moves to its own business, and is given back here, only for
-- the jobs assigned to (or declined by) that worker:
--   1. tenant_skills SELECT   the employer's skill list (labels shown on the phone)
--   2. customers SELECT       the customer of each of their jobs (the job sheet join)
--   3. job_status_history SELECT   the history of their jobs and "jobs I declined"
-- The phone does not write job_status_history itself (the report and decline triggers do, and
-- they run as the table owner), so no INSERT policy is needed.
--
-- Additive only. Permissive policies are OR-ed with the existing ones, so employees and the office
-- see exactly what they saw before. No policy is dropped except our own, by name, before it is made.
--
-- Recursion: every cross-table lookup goes through a SECURITY DEFINER helper, the same way
-- current_worker_declined_job_ids() already does for jobs (20260829170000).
--
-- Not changed, noted for later: the job-attachments storage bucket is public and any logged-in
-- user may read, upload to and update any file in it; and employees can still read every
-- customer in their employer's business ("Users can view own tenant customers" has no role test).

-- Employer businesses this login works for (not their own business, not a Rounds trader's own worker row).
CREATE OR REPLACE FUNCTION public.current_user_employer_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT w.primary_tenant_id
  FROM public.workers w
  WHERE w.user_id = auth.uid()
    AND w.primary_tenant_id IS NOT NULL
    AND w.worker_type IS DISTINCT FROM 'platform_solo'
    AND coalesce(w.invite_status, '') <> 'deactivated';
$$;

-- Jobs dispatched to this login's worker rows (never pending / pending_send).
CREATE OR REPLACE FUNCTION public.current_worker_assigned_job_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT j.id
  FROM public.jobs j
  JOIN public.workers w ON w.id = j.assigned_worker_id
  WHERE w.user_id = auth.uid()
    AND coalesce(w.invite_status, '') <> 'deactivated'
    AND j.status <> ALL (ARRAY['pending_send'::job_status, 'pending'::job_status]);
$$;

-- The customers of those jobs, and of jobs this worker declined.
CREATE OR REPLACE FUNCTION public.current_worker_customer_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT j.customer_id
  FROM public.jobs j
  WHERE j.customer_id IS NOT NULL
    AND (
      j.id IN (SELECT public.current_worker_assigned_job_ids())
      OR j.id IN (SELECT public.current_worker_declined_job_ids())
    );
$$;

REVOKE ALL ON FUNCTION public.current_user_employer_tenant_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_worker_assigned_job_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_worker_customer_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_employer_tenant_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_worker_assigned_job_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_worker_customer_ids() TO authenticated;

COMMENT ON FUNCTION public.current_user_employer_tenant_ids() IS
  'Worker web area: the businesses the signed-in login works for through a live workers row. Used by "Employer-linked worker" policies.';
COMMENT ON FUNCTION public.current_worker_assigned_job_ids() IS
  'Worker web area: dispatched jobs assigned to the signed-in login''s worker rows.';
COMMENT ON FUNCTION public.current_worker_customer_ids() IS
  'Worker web area: customers of the signed-in worker''s assigned or declined jobs.';

-- 1. The employer's skill list.
DROP POLICY IF EXISTS "Employer-linked worker can read employer skills" ON public.tenant_skills;
CREATE POLICY "Employer-linked worker can read employer skills"
ON public.tenant_skills
FOR SELECT
USING (tenant_id IN (SELECT public.current_user_employer_tenant_ids()));

-- 2. The customer of each of their jobs (only those, not the employer's customer list).
DROP POLICY IF EXISTS "Employer-linked worker can read customers of own jobs" ON public.customers;
CREATE POLICY "Employer-linked worker can read customers of own jobs"
ON public.customers
FOR SELECT
USING (id IN (SELECT public.current_worker_customer_ids()));

-- 3. The history of their jobs, and the jobs they declined.
DROP POLICY IF EXISTS "Employer-linked worker can read history of own jobs" ON public.job_status_history;
CREATE POLICY "Employer-linked worker can read history of own jobs"
ON public.job_status_history
FOR SELECT
USING (
  job_id IN (SELECT public.current_worker_assigned_job_ids())
  OR job_id IN (SELECT public.current_worker_declined_job_ids())
);

-- Check after pasting (read-only), as a worker login in the SQL editor's "impersonate" is not available,
-- so these only confirm the objects exist:
--   select proname from pg_proc where proname in
--     ('current_user_employer_tenant_ids','current_worker_assigned_job_ids','current_worker_customer_ids');   -- 3 rows
--   select tablename, policyname from pg_policies where policyname like 'Employer-linked worker%';           -- 3 rows
