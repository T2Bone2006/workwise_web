-- NOT A CHANGE. Housekeeping so the repo matches the database.
--
-- Four triggers on public.jobs were created in the Supabase dashboard and
-- exist in no migration file: job_report_outcome, on_job_declined,
-- sync_network_job_status, update_jobs_updated_at. More triggers are about to
-- land on jobs (Rounds payment status), so their definitions need to live
-- here first.
--
-- Run the query below in the SQL editor, then paste its output under the
-- marker line at the bottom of THIS file and commit it. Nothing to execute
-- beyond the SELECT.

SELECT
  '-- trigger: ' || t.tgname || E'\n' ||
  pg_get_functiondef(t.tgfoid) || E';\n' ||
  pg_get_triggerdef(t.oid) || E';\n'
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'jobs'
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- ===== paste output below this line =====

?column?
"-- trigger: job_outcome_webhook
CREATE OR REPLACE FUNCTION public.notify_job_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Only the transition itself. sync_network_job_status_fn copies the same
  -- status onto the canonical job and update_jobs_updated_at touches the row
  -- again; neither is a new outcome. The route re-checks this anyway.
  IF NEW.status IN ('declined', 'incomplete')
     AND NEW.status IS DISTINCT FROM OLD.status
  THEN
    PERFORM net.http_post(
      url := 'https://app.joinworkwise.com/api/hooks/job-outcome',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-workwise-hook-secret', '273df2b12944ac527ea5f962f80fe2f6698392a4214f4f08d15e8741e0f0382a'
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
$function$
;
CREATE TRIGGER job_outcome_webhook AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION notify_job_outcome();
"
"-- trigger: job_report_outcome
CREATE OR REPLACE FUNCTION public.handle_job_report_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_report_fields jsonb;
  v_field jsonb;
  v_field_id text;
  v_blocking_value jsonb;
  v_blocked_by text := null;
BEGIN
  IF NEW.status <> 'completed' OR OLD.status IS NOT DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  IF NEW.industry_data IS NULL OR jsonb_typeof(NEW.industry_data) <> 'object' THEN
    RETURN NEW;
  END IF;

  IF NEW.industry_data -> 'job_completed' = 'false'::jsonb THEN
    v_blocked_by := 'job_completed';
  END IF;

  IF v_blocked_by IS NULL THEN
    SELECT settings -> 'job_report_fields'
    INTO v_report_fields
    FROM public.tenants
    WHERE id = NEW.tenant_id;

    IF jsonb_typeof(v_report_fields) = 'array' THEN
      FOR v_field IN SELECT * FROM jsonb_array_elements(v_report_fields)
      LOOP
        CONTINUE WHEN jsonb_typeof(v_field) IS DISTINCT FROM 'object';
        CONTINUE WHEN v_field -> 'blocks_completion' IS DISTINCT FROM 'true'::jsonb;

        v_field_id := v_field ->> 'id';
        CONTINUE WHEN v_field_id IS NULL;

        -- A yes_no question blocks on ""yes"" unless told otherwise; a select
        -- can name any one of its options as the blocking answer.
        v_blocking_value := COALESCE(v_field -> 'blocking_value', 'true'::jsonb);

        IF NEW.industry_data -> v_field_id = v_blocking_value THEN
          v_blocked_by := v_field_id;
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF v_blocked_by IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.status := 'incomplete';

  INSERT INTO public.job_status_history (
    job_id, from_status, to_status, changed_by_worker_id, notes, metadata
  ) VALUES (
    NEW.id,
    OLD.status,
    'incomplete',
    NEW.assigned_worker_id,
    'Report submitted — work not completed',
    jsonb_strip_nulls(
      jsonb_build_object(
        'blocked_by', v_blocked_by,
        'reason', NULLIF(btrim(COALESCE(NEW.industry_data ->> 'incomplete_reason', '')), '')
      )
    )
  );

  RETURN NEW;
END;
$function$
;
CREATE TRIGGER job_report_outcome BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION handle_job_report_outcome();
"
"-- trigger: on_job_declined
CREATE OR REPLACE FUNCTION public.handle_job_declined()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dispatch RECORD;
  v_new_job_id uuid;
  v_reason_metadata jsonb;
BEGIN
  IF NEW.status = 'declined' AND OLD.status != 'declined' THEN

    v_reason_metadata := CASE
      WHEN NEW.decline_reason IS NOT NULL AND btrim(NEW.decline_reason) <> ''
      THEN jsonb_build_object('reason', btrim(NEW.decline_reason))
      ELSE '{}'::jsonb
    END;

    IF NEW.network_dispatch_id IS NOT NULL THEN
      SELECT id, originating_tenant_id, receiving_tenant_id,
             originating_reference_number, canonical_job_id
      INTO v_dispatch
      FROM public.network_job_dispatches
      WHERE id = NEW.network_dispatch_id;

      IF NEW.tenant_id = v_dispatch.receiving_tenant_id THEN

        IF NEW.assigned_worker_id IS NULL THEN
          UPDATE public.jobs
          SET status = 'pending',
              updated_at = now()
          WHERE id = v_dispatch.canonical_job_id;

          INSERT INTO public.job_status_history (
            job_id, from_status, to_status, notes, metadata
          ) VALUES (
            v_dispatch.canonical_job_id, 'declined', 'pending',
            'Returned from network — receiving business declined dispatch',
            v_reason_metadata
          );

        ELSE
          UPDATE public.jobs
          SET assigned_worker_id = null,
              updated_at = now()
          WHERE id = NEW.id;

          INSERT INTO public.job_status_history (
            job_id, from_status, to_status,
            changed_by_worker_id, notes, metadata
          ) VALUES (
            NEW.id, OLD.status, 'declined',
            NEW.assigned_worker_id,
            'Worker declined the job',
            v_reason_metadata
          );
        END IF;

      ELSIF NEW.tenant_id = v_dispatch.originating_tenant_id THEN
        NULL;
      END IF;

    ELSE
      UPDATE public.jobs
      SET assigned_worker_id = null,
          updated_at = now()
      WHERE id = NEW.id;

      INSERT INTO public.job_status_history (
        job_id, from_status, to_status,
        changed_by_worker_id, notes, metadata
      ) VALUES (
        NEW.id, OLD.status, 'declined',
        NEW.assigned_worker_id,
        'Worker declined the job',
        v_reason_metadata
      );
    END IF;

  END IF;

  RETURN NEW;
END;
$function$
;
CREATE TRIGGER on_job_declined AFTER UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION handle_job_declined();
"
"-- trigger: sync_network_job_status
CREATE OR REPLACE FUNCTION public.sync_network_job_status_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_canonical_job_id uuid;
BEGIN
  IF NEW.status = 'declined' THEN
    RETURN NEW;
  END IF;

  SELECT canonical_job_id
  INTO v_canonical_job_id
  FROM network_job_dispatches
  WHERE id = NEW.network_dispatch_id;

  IF v_canonical_job_id IS NOT NULL AND v_canonical_job_id != NEW.id THEN
    UPDATE jobs
    SET status = NEW.status,
        updated_at = now()
    WHERE id = v_canonical_job_id;
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE TRIGGER sync_network_job_status AFTER UPDATE ON public.jobs FOR EACH ROW WHEN (((old.status IS DISTINCT FROM new.status) AND (new.network_dispatch_id IS NOT NULL))) EXECUTE FUNCTION sync_network_job_status_fn();
"
"-- trigger: update_jobs_updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
"