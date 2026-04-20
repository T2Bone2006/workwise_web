-- RLS policies for job_status_history
-- Run this in Supabase SQL Editor if status history is not updating or not visible.
-- Ensures authenticated users can SELECT and INSERT rows for jobs belonging to their tenant.

-- Drop existing policies if they exist (adjust names if your DB uses different policy names)
DROP POLICY IF EXISTS "Users can view their tenant's job history" ON job_status_history;
DROP POLICY IF EXISTS "job_history_tenant_select" ON job_status_history;
DROP POLICY IF EXISTS "job_history_tenant_insert" ON job_status_history;
DROP POLICY IF EXISTS "job_history_tenant_delete" ON job_status_history;

-- Enable RLS if not already
ALTER TABLE job_status_history ENABLE ROW LEVEL SECURITY;

-- Allow SELECT: users can see status history for jobs in their tenant
CREATE POLICY "job_history_tenant_select"
ON job_status_history FOR SELECT
TO authenticated
USING (
  job_id IN (
    SELECT id FROM jobs
    WHERE tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  )
);

-- Allow INSERT: users can insert status history for jobs in their tenant
CREATE POLICY "job_history_tenant_insert"
ON job_status_history FOR INSERT
TO authenticated
WITH CHECK (
  job_id IN (
    SELECT id FROM jobs
    WHERE tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  )
);

-- Allow DELETE: users can remove status history for jobs in their tenant (e.g. when deleting a job)
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
