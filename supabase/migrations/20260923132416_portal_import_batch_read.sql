-- Let customer portal users read import sources and import history for their
-- linked customers, so the portal jobs list can offer "import batch" filtering
-- (same job_ids filter the office list uses). SELECT only — no writes.

ALTER TABLE public.import_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Portal users can read own import sources" ON public.import_sources;
DROP POLICY IF EXISTS "Portal users can read own import history" ON public.import_history;

CREATE POLICY "Portal users can read own import sources"
ON public.import_sources
FOR SELECT
TO authenticated
USING (
  customer_id IN (
    SELECT cpu.customer_id
    FROM public.customer_portal_users cpu
    WHERE cpu.user_id = auth.uid()
  )
);

CREATE POLICY "Portal users can read own import history"
ON public.import_history
FOR SELECT
TO authenticated
USING (
  import_source_id IN (
    SELECT s.id
    FROM public.import_sources s
    WHERE s.customer_id IN (
      SELECT cpu.customer_id
      FROM public.customer_portal_users cpu
      WHERE cpu.user_id = auth.uid()
    )
  )
);
