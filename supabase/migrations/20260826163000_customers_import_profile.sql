-- Customer-owned import mapping profile (replaces user-facing import sources).
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS import_column_mapping jsonb,
  ADD COLUMN IF NOT EXISTS import_value_transforms jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS import_expected_headers text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS import_mapping_updated_at timestamp with time zone;

-- Backfill from the most-used / most-recent import_source linked to each customer.
WITH ranked AS (
  SELECT
    customer_id,
    column_mapping,
    COALESCE(value_transforms, '{}'::jsonb) AS value_transforms,
    ROW_NUMBER() OVER (
      PARTITION BY customer_id
      ORDER BY times_used DESC NULLS LAST, last_used_at DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM public.import_sources
  WHERE customer_id IS NOT NULL
    AND is_active IS DISTINCT FROM false
)
UPDATE public.customers c
SET
  import_column_mapping = r.column_mapping,
  import_value_transforms = r.value_transforms,
  import_expected_headers = COALESCE(
    (
      SELECT array_agg(DISTINCT v)
      FROM jsonb_each_text(r.column_mapping) AS t(k, v)
      WHERE v IS NOT NULL AND btrim(v) <> ''
    ),
    '{}'::text[]
  ),
  import_mapping_updated_at = now()
FROM ranked r
WHERE c.id = r.customer_id
  AND r.rn = 1
  AND c.import_column_mapping IS NULL;
