-- Every status change writes a history line, including ones made on the phone.
-- The office, rounds and the decline / not-completed triggers already insert their own
-- line just after the update. A second insert of the same step within a few seconds
-- is folded into the first, so those notes are kept and the line is not doubled.
-- Then the missing start and finish lines are filled from the times already on the job.
-- Accept and pause have no saved time, so those steps cannot be rebuilt.

CREATE OR REPLACE FUNCTION public.log_job_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_worker uuid;
  v_user uuid;
  v_notes text;
  v_metadata jsonb := '{}'::jsonb;
  v_reason text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF v_uid IS NOT NULL THEN
    SELECT w.id INTO v_worker
    FROM public.workers w
    WHERE w.user_id = v_uid
      AND w.id = NEW.assigned_worker_id
    LIMIT 1;

    IF v_worker IS NULL THEN
      SELECT u.id INTO v_user
      FROM public.users u
      WHERE u.id = v_uid;
    END IF;
  END IF;

  IF NEW.status = 'completed'
     AND jsonb_typeof(NEW.industry_data) = 'object'
     AND NEW.industry_data <> '{}'::jsonb THEN
    v_notes := 'Report submitted';
  ELSIF NEW.status = 'paused' AND jsonb_typeof(NEW.industry_data) = 'object' THEN
    v_reason := NULLIF(btrim(COALESCE(NEW.industry_data ->> 'pause_reason', '')), '');
    IF v_reason IS NOT NULL THEN
      v_metadata := jsonb_build_object('reason', v_reason);
    END IF;
  END IF;

  INSERT INTO public.job_status_history (
    job_id, from_status, to_status, changed_by_user_id, changed_by_worker_id, notes, metadata
  ) VALUES (
    NEW.id, OLD.status, NEW.status, v_user, v_worker, v_notes, v_metadata
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_job_status_change ON public.jobs;
CREATE TRIGGER log_job_status_change
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.log_job_status_change();

CREATE OR REPLACE FUNCTION public.collapse_duplicate_job_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
BEGIN
  -- Same-status notes (a visit moved, pushed back, or given to someone) are their own events.
  IF NEW.from_status IS NOT DISTINCT FROM NEW.to_status THEN
    RETURN NEW;
  END IF;

  SELECT h.id INTO v_existing
  FROM public.job_status_history h
  WHERE h.job_id = NEW.job_id
    AND h.to_status = NEW.to_status
    AND h.from_status IS NOT DISTINCT FROM NEW.from_status
    AND h.created_at > now() - interval '15 seconds'
  ORDER BY h.created_at DESC
  LIMIT 1;

  IF v_existing IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.job_status_history h
  SET
    notes = COALESCE(NEW.notes, h.notes),
    metadata = CASE
      WHEN NEW.metadata IS NULL OR NEW.metadata = '{}'::jsonb THEN h.metadata
      ELSE h.metadata || NEW.metadata
    END,
    changed_by_user_id = COALESCE(NEW.changed_by_user_id, h.changed_by_user_id),
    changed_by_worker_id = COALESCE(h.changed_by_worker_id, NEW.changed_by_worker_id),
    created_at = NEW.created_at
  WHERE h.id = v_existing;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS job_status_history_collapse_duplicate ON public.job_status_history;
CREATE TRIGGER job_status_history_collapse_duplicate
  BEFORE INSERT ON public.job_status_history
  FOR EACH ROW
  EXECUTE FUNCTION public.collapse_duplicate_job_status_history();

-- Start, from the time already stored on the job.
INSERT INTO public.job_status_history (
  job_id, from_status, to_status, changed_by_worker_id, notes, metadata, created_at
)
SELECT
  s.job_id, s.from_status, s.to_status, s.changed_by_worker_id, s.notes, s.metadata, s.created_at
FROM (
  SELECT
    j.id AS job_id,
    COALESCE(
      (
        SELECT h.to_status
        FROM public.job_status_history h
        WHERE h.job_id = j.id
          AND h.created_at <= j.started_at
        ORDER BY h.created_at DESC
        LIMIT 1
      ),
      CASE
        WHEN j.assigned_worker_id IS NOT NULL THEN 'assigned'::public.job_status
        ELSE 'pending'::public.job_status
      END
    ) AS from_status,
    'in_progress'::public.job_status AS to_status,
    j.assigned_worker_id AS changed_by_worker_id,
    NULL::text AS notes,
    '{}'::jsonb AS metadata,
    j.started_at AS created_at
  FROM public.jobs j
  WHERE j.started_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.job_status_history h
      WHERE h.job_id = j.id
        AND h.to_status = 'in_progress'
    )
) s
WHERE s.from_status IS DISTINCT FROM s.to_status;

-- Finish, from the time already stored on the job.
INSERT INTO public.job_status_history (
  job_id, from_status, to_status, changed_by_worker_id, notes, metadata, created_at
)
SELECT
  s.job_id, s.from_status, s.to_status, s.changed_by_worker_id, s.notes, s.metadata, s.created_at
FROM (
  SELECT
    j.id AS job_id,
    COALESCE(
      (
        SELECT h.to_status
        FROM public.job_status_history h
        WHERE h.job_id = j.id
          AND h.created_at <= j.completed_at
        ORDER BY h.created_at DESC
        LIMIT 1
      ),
      CASE
        WHEN j.started_at IS NOT NULL THEN 'in_progress'::public.job_status
        WHEN j.assigned_worker_id IS NOT NULL THEN 'assigned'::public.job_status
        ELSE 'pending'::public.job_status
      END
    ) AS from_status,
    'completed'::public.job_status AS to_status,
    j.assigned_worker_id AS changed_by_worker_id,
    CASE
      WHEN jsonb_typeof(j.industry_data) = 'object' AND j.industry_data <> '{}'::jsonb
        THEN 'Report submitted'
      ELSE NULL
    END AS notes,
    '{}'::jsonb AS metadata,
    j.completed_at AS created_at
  FROM public.jobs j
  WHERE j.status = 'completed'
    AND j.completed_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.job_status_history h
      WHERE h.job_id = j.id
        AND h.to_status = 'completed'
    )
) s
WHERE s.from_status IS DISTINCT FROM s.to_status;
