-- Deleting a job failed with "violates foreign key constraint notifications_job_id_fkey".
-- These three tables only keep a log/pointer to the job, so let them forget the job
-- when it is deleted instead of blocking the delete.
--   notifications.job_id         send log: keep the row, drop the link
--   ai_interactions.job_id       AI usage log: keep the row, drop the link
--   leads.converted_job_id       lead stays, just no longer points at the deleted job
-- network_job_dispatches.canonical_job_id is deliberately left blocking (NOT NULL, and
-- the other business holds a copy), so the app now says so in plain words.

ALTER TABLE public.notifications
  DROP CONSTRAINT notifications_job_id_fkey,
  ADD CONSTRAINT notifications_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;

ALTER TABLE public.ai_interactions
  DROP CONSTRAINT ai_interactions_job_id_fkey,
  ADD CONSTRAINT ai_interactions_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;

ALTER TABLE public.leads
  DROP CONSTRAINT leads_converted_job_id_fkey,
  ADD CONSTRAINT leads_converted_job_id_fkey
    FOREIGN KEY (converted_job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;
