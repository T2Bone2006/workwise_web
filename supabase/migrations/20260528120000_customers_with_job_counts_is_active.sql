-- Expose is_active on list view so active-only filters work in PostgREST.
CREATE OR REPLACE VIEW public.customers_with_job_counts
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.tenant_id,
  c.name,
  c.type,
  c.email,
  c.phone,
  c.notes,
  c.is_active,
  c.created_at,
  c.updated_at,
  (
    SELECT COUNT(*)::integer
    FROM public.jobs j
    WHERE j.customer_id = c.id
      AND j.tenant_id = c.tenant_id
  ) AS job_count
FROM public.customers c;
