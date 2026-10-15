-- Calendar update (micro-phase), file 1 of 1. Paste after the Phase 5 files
-- (or on its own; it only depends on 20260929100200_visit_changes.sql).
--
-- Adds kind 'swap_days' to visit_changes: dragging one day onto another on
-- the Week board swaps their planned stops as ONE undoable change.
-- from_date = the day that was dragged, to_date = the day it was dropped on.
-- `before` holds the snapshot of every job from both days (same shape as the
-- other kinds).
--
-- client_key: a uuid the dashboard/phone makes once per swap confirm. The
-- swap inserts its visit_changes row FIRST, so a double tap or a retried
-- request hits the unique index and becomes "already done" instead of
-- swapping the days back. Null for every other kind. No new policies or grants.

BEGIN;

ALTER TABLE public.visit_changes
  ADD COLUMN IF NOT EXISTS client_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_visit_changes_tenant_client_key
  ON public.visit_changes (tenant_id, client_key)
  WHERE client_key IS NOT NULL;

COMMENT ON COLUMN public.visit_changes.client_key IS
  'Set by swap_days only: one uuid per swap request, so a replay is refused by uq_visit_changes_tenant_client_key.';

ALTER TABLE public.visit_changes
  DROP CONSTRAINT IF EXISTS visit_changes_kind_check;

ALTER TABLE public.visit_changes
  ADD CONSTRAINT visit_changes_kind_check CHECK (
    kind IN ('skip', 'reschedule', 'move_remaining', 'skip_remaining', 'swap_days')
  );

ALTER TABLE public.visit_changes
  DROP CONSTRAINT IF EXISTS visit_changes_dates_check;

ALTER TABLE public.visit_changes
  ADD CONSTRAINT visit_changes_dates_check CHECK (
    (kind IN ('reschedule', 'move_remaining') AND to_date IS NOT NULL)
    OR (
      kind = 'swap_days'
      AND from_date IS NOT NULL
      AND to_date IS NOT NULL
      AND from_date <> to_date
    )
    OR kind IN ('skip', 'skip_remaining')
  );

COMMENT ON COLUMN public.visit_changes.kind IS
  'skip | reschedule | move_remaining | skip_remaining | swap_days. swap_days: from_date = day dragged, to_date = day dropped on; jobs from both days are in job_ids/before.';

COMMIT;

-- Checks (run after pasting; each should return what the comment says):
-- 1. Both constraints mention swap_days → 2 rows
-- SELECT conname FROM pg_constraint
--  WHERE conrelid = 'public.visit_changes'::regclass
--    AND pg_get_constraintdef(oid) LIKE '%swap_days%';
-- 2. Existing rows still valid → 0
-- SELECT count(*) FROM public.visit_changes
--  WHERE kind NOT IN ('skip','reschedule','move_remaining','skip_remaining','swap_days');
-- 3. The new column and index exist → 1 row
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'visit_changes' AND indexname = 'uq_visit_changes_tenant_client_key';
