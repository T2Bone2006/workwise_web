-- Fixes a NULL trap that marked completed jobs as not completed.
--
-- The loop skipped fields that are not blocking with:
--
--   CONTINUE WHEN v_field -> 'blocks_completion' <> 'true'::jsonb;
--
-- A field without that key yields SQL NULL, and `NULL <> 'true'` is NULL,
-- not TRUE — so CONTINUE never fired and the field was NOT skipped. It then
-- fell through to the match, where blocking_value defaults to true, so ANY
-- yes_no question answered "Yes" blocked completion. RS's "Was the lock
-- changed?" answered Yes was enough to mark a finished job incomplete.
--
-- IS DISTINCT FROM is NULL-safe: NULL IS DISTINCT FROM 'true' is TRUE, so
-- unmarked fields are now skipped as intended. It also stays strict about the
-- marker's type — the jsonb string "true" is distinct from the boolean true,
-- so only a real `"blocks_completion": true` counts.
--
-- Body is otherwise unchanged from 20260829150100. SECURITY DEFINER is
-- re-specified deliberately: CREATE OR REPLACE does not preserve it.
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
        CONTINUE WHEN jsonb_typeof(v_field) IS DISTINCT FROM 'object';
        CONTINUE WHEN v_field -> 'blocks_completion' IS DISTINCT FROM 'true'::jsonb;

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
