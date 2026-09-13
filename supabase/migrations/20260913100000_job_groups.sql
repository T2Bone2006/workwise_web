-- Job groups: a set of jobs that travel together to one worker.
--
-- The motivating case is a customer spreadsheet where several addresses belong
-- to one visit (e.g. one warrant officer's day) and the whole set must go to the
-- same locksmith — but the concept is trade-agnostic (a plumber's morning run,
-- an electrician doing one estate), so nothing here names the domain.
--
-- Groups are created either manually (jobs list: select rows → "Group selected")
-- or at import time from matching column values (see import_sources.grouping_columns,
-- added in a later migration). Assigning a group cascades the worker to every
-- member job; a member can still be reassigned individually — the group is an
-- affordance, not a constraint.
--
-- Deliberately no schedule on the group: date/time live on the jobs and the
-- label summarises them, so there is one source of truth.

CREATE TABLE IF NOT EXISTS public.job_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  label text NOT NULL,
  -- Which import run created the group, when it was auto-detected. NULL = manual.
  import_history_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT job_groups_pkey PRIMARY KEY (id),
  CONSTRAINT job_groups_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT job_groups_import_history_id_fkey FOREIGN KEY (import_history_id)
    REFERENCES public.import_history(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.job_groups IS
  'A set of jobs that should be assigned to one worker together. Trade-agnostic.';

CREATE INDEX IF NOT EXISTS idx_job_groups_tenant_id ON public.job_groups (tenant_id);

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS job_group_id uuid;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_job_group_id_fkey;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_job_group_id_fkey FOREIGN KEY (job_group_id)
    REFERENCES public.job_groups(id) ON DELETE SET NULL;

-- Group header + member lookups on the jobs list.
CREATE INDEX IF NOT EXISTS idx_jobs_job_group_id
  ON public.jobs (job_group_id)
  WHERE job_group_id IS NOT NULL;

-- Tenant-scoped like import_history. Only office logins touch groups today;
-- the worker app has no concept of them yet, so no worker branch.
ALTER TABLE public.job_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_groups_tenant_select" ON public.job_groups;
DROP POLICY IF EXISTS "job_groups_tenant_insert" ON public.job_groups;
DROP POLICY IF EXISTS "job_groups_tenant_update" ON public.job_groups;
DROP POLICY IF EXISTS "job_groups_tenant_delete" ON public.job_groups;

CREATE POLICY "job_groups_tenant_select"
ON public.job_groups FOR SELECT
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
);

CREATE POLICY "job_groups_tenant_insert"
ON public.job_groups FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
);

CREATE POLICY "job_groups_tenant_update"
ON public.job_groups FOR UPDATE
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
)
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
);

CREATE POLICY "job_groups_tenant_delete"
ON public.job_groups FOR DELETE
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
);
