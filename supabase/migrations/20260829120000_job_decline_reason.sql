-- Capture the worker's free-text reason for declining a job.
--
-- decline_reason is transient: the client sets it in the same UPDATE that
-- sets status = 'declined', handle_job_declined() reads it off NEW and
-- writes it into job_status_history.metadata (a permanent record of that
-- one decline event), then clears it back to NULL so it never lingers on
-- the job row through a later reassignment/accept/decline cycle.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS decline_reason text NULL;

CREATE OR REPLACE FUNCTION public.handle_job_declined()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
          -- Receiving business declined from inbox — return canonical job to originator
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
          -- Worker at receiving business declined — reset to pending in their queue
          UPDATE public.jobs
          SET status = 'pending',
              assigned_worker_id = null,
              decline_reason = NULL,
              updated_at = now()
          WHERE id = NEW.id;

          INSERT INTO public.job_status_history (
            job_id, from_status, to_status,
            changed_by_worker_id, notes, metadata
          ) VALUES (
            NEW.id, 'declined', 'pending',
            NEW.assigned_worker_id,
            'Worker declined — returned to receiving business queue',
            v_reason_metadata
          );
        END IF;

      ELSIF NEW.tenant_id = v_dispatch.originating_tenant_id THEN
        -- Originating tenant job declined — no action needed, sync handles status
        NULL;
      END IF;

    ELSE
      -- Regular job declined by worker
      UPDATE public.jobs
      SET status = 'pending',
          assigned_worker_id = null,
          decline_reason = NULL,
          updated_at = now()
      WHERE id = NEW.id;

      INSERT INTO public.job_status_history (
        job_id, from_status, to_status,
        changed_by_worker_id, notes, metadata
      ) VALUES (
        NEW.id, 'declined', 'pending',
        NEW.assigned_worker_id,
        'Worker declined — returned to pending queue',
        v_reason_metadata
      );
    END IF;

  END IF;

  RETURN NEW;
END;
$$;
