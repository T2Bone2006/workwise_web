-- Phase 3 (messaging), file 3 of 3. Paste after 20260929100100.
--
-- visit_changes: one row per Skip / Reschedule / Move remaining / Skip
-- remaining, with a snapshot of every visit it touched, so the trader can
-- Undo it and so "Let customers know" knows who to tell.
--
-- `before` is a JSON array, one object per job, written by the app:
--   { "job_id", "status", "scheduled_date", "scheduled_time", "route_position",
--     "skip_reason", "completion_notes", "customer_confirmation_status",
--     "customer_requested_date", "service_agreement_id",
--     "agreement_schedule_mode", "agreement_next_due_date" }
--
-- Written with the trader's own login (dashboard or phone), so admins of the
-- business may insert and update. Never deleted (history).

CREATE TABLE IF NOT EXISTS public.visit_changes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL,
  from_date date,
  to_date date,
  job_ids uuid[] NOT NULL,
  before jsonb NOT NULL,
  notify_customers boolean NOT NULL DEFAULT false,
  notified_at timestamp with time zone,
  created_by_user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  undone_at timestamp with time zone,
  undone_by_user_id uuid,
  undo_notified_at timestamp with time zone,
  CONSTRAINT visit_changes_pkey PRIMARY KEY (id),
  CONSTRAINT visit_changes_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT visit_changes_kind_check CHECK (
    kind IN ('skip', 'reschedule', 'move_remaining', 'skip_remaining')
  ),
  CONSTRAINT visit_changes_jobs_check CHECK (cardinality(job_ids) >= 1),
  CONSTRAINT visit_changes_before_check CHECK (jsonb_typeof(before) = 'array'),
  CONSTRAINT visit_changes_dates_check CHECK (
    (kind IN ('reschedule', 'move_remaining') AND to_date IS NOT NULL)
    OR kind IN ('skip', 'skip_remaining')
  )
);

CREATE INDEX IF NOT EXISTS idx_visit_changes_tenant_created
  ON public.visit_changes (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visit_changes_tenant_from_date
  ON public.visit_changes (tenant_id, from_date);

ALTER TABLE public.visit_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visit_changes_admin_select" ON public.visit_changes;
DROP POLICY IF EXISTS "visit_changes_admin_insert" ON public.visit_changes;
DROP POLICY IF EXISTS "visit_changes_admin_update" ON public.visit_changes;

CREATE POLICY "visit_changes_admin_select"
ON public.visit_changes FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "visit_changes_admin_insert"
ON public.visit_changes FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "visit_changes_admin_update"
ON public.visit_changes FOR UPDATE
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

REVOKE ALL ON public.visit_changes FROM anon;
REVOKE DELETE ON public.visit_changes FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.visit_changes TO authenticated;

-- messages.visit_change_id -> visit_changes (the column was added in file 1).
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_visit_change_id_fkey;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_visit_change_id_fkey FOREIGN KEY (visit_change_id)
    REFERENCES public.visit_changes(id) ON DELETE SET NULL;

-- Skip remaining ("I can't make it today") gets its own reason.
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_skip_reason_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_skip_reason_check CHECK (
    skip_reason IS NULL OR skip_reason IN (
      'no_access', 'weather', 'customer_declined', 'customer_away',
      'agreement_paused', 'agreement_ended', 'other', 'trader_unavailable'
    )
  );
