-- Decides, at the moment a job report lands, whether the work actually got
-- done. Runs BEFORE UPDATE so the status is rewritten in place rather than
-- needing a second write.
--
-- Two things can block completion:
--
--   1. `job_completed` — hard-coded in the worker app, so every tenant has it.
--   2. Any tenant-configured report field marked `"blocks_completion": true`
--      in tenants.settings.job_report_fields, when its answer equals the
--      field's `blocking_value` (defaults to true, the yes_no case).
--
-- Deliberately no field IDs in here. RS Locksmiths' blocking question is
-- `walk_away`, but the next client's will be called something else and this
-- must not need editing for them.
CREATE OR REPLACE FUNCTION public.handle_job_report_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        CONTINUE WHEN jsonb_typeof(v_field) <> 'object';
        CONTINUE WHEN v_field -> 'blocks_completion' <> 'true'::jsonb;

        v_field_id := v_field ->> 'id';
        CONTINUE WHEN v_field_id IS NULL;

        -- A yes_no question blocks on "yes" unless told otherwise; a select
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

  -- The worker app does not write status history for its own updates (only
  -- declines do, via handle_job_declined). Record this one, since the office
  -- needs to know when the attempt ended and what stopped it.
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
$$;

DROP TRIGGER IF EXISTS job_report_outcome ON public.jobs;

CREATE TRIGGER job_report_outcome
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_job_report_outcome();
