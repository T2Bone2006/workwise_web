-- Calls the dashboard's /api/hooks/job-outcome route when a job ends badly,
-- so the tenant gets emailed. This is the same mechanism as a Supabase
-- "Database Webhook" from the dashboard UI — that UI just writes a trigger
-- like this one — but doing it here keeps it in version control instead of
-- being invisible dashboard state, which is how the other four triggers on
-- this table ended up untracked.
--
-- BEFORE RUNNING: replace __HOOK_URL__ and __HOOK_SECRET__ below. The secret
-- must match JOB_OUTCOME_HOOK_SECRET in the app's environment.
--
-- Do NOT commit the filled-in version — keep the placeholders in the repo.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_job_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Only the transition itself. sync_network_job_status_fn copies the same
  -- status onto the canonical job and update_jobs_updated_at touches the row
  -- again; neither is a new outcome. The route re-checks this anyway.
  IF NEW.status IN ('declined', 'incomplete')
     AND NEW.status IS DISTINCT FROM OLD.status
  THEN
    PERFORM net.http_post(
      url := '__HOOK_URL__',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-workwise-hook-secret', '__HOOK_SECRET__'
      ),
      body := jsonb_build_object(
        'type', 'UPDATE',
        'table', 'jobs',
        'schema', 'public',
        'record', to_jsonb(NEW),
        'old_record', to_jsonb(OLD)
      )
    );
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS job_outcome_webhook ON public.jobs;

-- AFTER, so the row is committed before the request goes out, and the email
-- can never hold up or roll back the worker's status change. net.http_post is
-- queued by pg_net and delivered out of band, so this adds no latency.
CREATE TRIGGER job_outcome_webhook
  AFTER UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_job_outcome();
