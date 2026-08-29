-- CREATE OR REPLACE FUNCTION does not preserve SECURITY DEFINER unless
-- re-specified — my two prior edits to handle_job_declined() both omitted it,
-- silently downgrading it to SECURITY INVOKER. Its own internal UPDATE then
-- ran as the calling worker's restricted RLS permissions instead of
-- bypassing RLS, and got rejected. Body unchanged from the last migration;
-- only the security context is restored.
CREATE OR REPLACE FUNCTION public.handle_job_declined()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
$$;
