-- Allow authenticated users to delete status history rows for jobs in their tenant
-- (required when removing jobs and related history from the dashboard).

DROP POLICY IF EXISTS "job_history_tenant_delete" ON job_status_history;

CREATE POLICY "job_history_tenant_delete"
ON job_status_history FOR DELETE
TO authenticated
USING (
  job_id IN (
    SELECT id FROM jobs
    WHERE tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  )
);
