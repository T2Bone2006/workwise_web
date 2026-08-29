-- Declined jobs now stay 'declined' instead of auto-bouncing to 'pending'.
--
-- Previously a decline was invisible: the trigger reset status to 'pending'
-- and unassigned it in the same transaction, so nothing ever showed a job
-- as declined and it could silently loop back to the same worker. Now it
-- sits in 'declined' — visible on the dashboard/jobs banners and the job's
-- own page — until a dispatcher explicitly assigns someone (auto-assign,
-- which already excludes any worker who declined THIS job, or manual). No
-- automatic retry.
--
-- decline_reason is no longer cleared here — it stays on the job for display
-- while it sits declined, and is cleared by assignJob() when someone is
-- actually assigned (see lib/actions/jobs.ts).
--
-- job_status_history now records the real transition (from_status = OLD.status,
-- e.g. 'assigned' → 'declined') instead of the synthetic 'declined' → 'pending'
-- framing the bounce used.
--
-- Only the two worker-decline branches change. The "receiving business
-- declined from inbox" branch (no worker involved — a network dispatch offer
-- being turned down) and the no-op originating-tenant branch are unchanged.
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
          -- Receiving business declined from inbox — return canonical job to originator.
          -- Unchanged: no worker involved, nothing to reassign in place.
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
          -- Worker at receiving business declined — stays 'declined' for that
          -- business to review and reassign, same as a regular decline.
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
        -- Originating tenant job declined — no action needed, sync handles status
        NULL;
      END IF;

    ELSE
      -- Regular job declined by worker — stays 'declined' until a dispatcher
      -- assigns someone; no automatic bounce or retry.
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
