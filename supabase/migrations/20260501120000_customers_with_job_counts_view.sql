-- List view: computed job_count per customer for sort + pagination (PostgREST cannot order by embedded aggregates).
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
  c.created_at,
  c.updated_at,
  (
    SELECT COUNT(*)::integer
    FROM public.jobs j
    WHERE j.customer_id = c.id
      AND j.tenant_id = c.tenant_id
  ) AS job_count
FROM public.customers c;

GRANT SELECT ON public.customers_with_job_counts TO authenticated;
GRANT SELECT ON public.customers_with_job_counts TO service_role;
