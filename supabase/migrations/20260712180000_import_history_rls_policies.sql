-- import_history had RLS enabled with SELECT but no INSERT policy, so every
-- import silently failed to write history (0 rows in the table).
-- Match the tenant-scoped pattern used elsewhere (e.g. job_status_history).

ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_history_tenant_select" ON public.import_history;
DROP POLICY IF EXISTS "import_history_tenant_insert" ON public.import_history;

CREATE POLICY "import_history_tenant_select"
ON public.import_history FOR SELECT
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
);

CREATE POLICY "import_history_tenant_insert"
ON public.import_history FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
  AND (
    imported_by_user_id IS NULL
    OR imported_by_user_id = auth.uid()
  )
);
