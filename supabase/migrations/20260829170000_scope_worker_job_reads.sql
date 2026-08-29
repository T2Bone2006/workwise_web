-- The worker branch of the jobs SELECT policy never fired.
--
-- The policy reads `A OR B`, where B is carefully scoped — your own assigned
-- jobs, never `pending` or `pending_send`. But A is
-- `tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid())`, and
-- worker logins DO get a public.users row with role='worker' and a tenant_id
-- (app/api/invite/confirm/route.ts). So A was already true for them, B never
-- constrained anything, and every worker could read every job in the tenant —
-- including quoted_amount / final_amount, and including pending_send jobs that
-- had deliberately not been dispatched. The app only hid those with a
-- client-side .neq(), which is a UI filter, not a control.
--
-- Fix: A applies to office logins only; workers fall through to B.
--
-- B alone is not quite enough, though. handle_job_declined() clears
-- assigned_worker_id, so a job a worker declined is no longer attached to them
-- and B cannot match it — which would empty the "Declined jobs" list in the
-- app's profile. job_status_history is the durable record of who declined
-- what, so C restores exactly those.
--
-- C has to go through a SECURITY DEFINER function rather than an inline
-- EXISTS. job_status_history's own policy selects from jobs, so an inline
-- subquery would make jobs' policy read history, whose policy reads jobs —
-- Postgres would abort with infinite recursion. The function bypasses RLS on
-- history, breaking the cycle.

CREATE OR REPLACE FUNCTION public.current_worker_declined_job_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT h.job_id
  FROM public.job_status_history h
  JOIN public.workers w ON w.id = h.changed_by_worker_id
  WHERE w.user_id = auth.uid()
    AND h.to_status = 'declined'
    AND h.job_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.current_worker_declined_job_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_worker_declined_job_ids() TO authenticated;

-- Keeps the lookup above off a sequential scan as history grows.
CREATE INDEX IF NOT EXISTS idx_job_status_history_worker_status
  ON public.job_status_history (changed_by_worker_id, to_status)
  WHERE changed_by_worker_id IS NOT NULL;

DROP POLICY IF EXISTS "Users and workers can view own tenant jobs" ON public.jobs;

CREATE POLICY "Users and workers can view own tenant jobs"
ON public.jobs
FOR SELECT
USING (
  -- A: office logins see their whole tenant, as before.
  tenant_id IN (
    SELECT users.tenant_id
    FROM public.users
    WHERE users.id = auth.uid()
      AND users.role IS DISTINCT FROM 'worker'
  )
  -- B: a worker sees the jobs actually dispatched to them.
  OR (
    assigned_worker_id IN (
      SELECT workers.id
      FROM public.workers
      WHERE workers.user_id = auth.uid()
    )
    AND status <> ALL (ARRAY['pending_send'::job_status, 'pending'::job_status])
  )
  -- C: plus the ones they declined, which B can no longer reach.
  OR id IN (SELECT public.current_worker_declined_job_ids())
);
