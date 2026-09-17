-- Backfill: every existing tenant that today gets Pro via the legacy
-- settings.features.pro flag (true, or absent — the old code defaulted to
-- true) receives a manual 'pro' subscription row.
--
-- Run this before deploying the dashboard change that reads subscriptions.
-- Expected result today: RS Locksmiths and Eden Technologies. Check the
-- SELECT at the bottom before moving on.
--
-- Tenants that explicitly set features.pro = false are skipped.

INSERT INTO public.subscriptions (tenant_id, product, status, source, seats, notes)
SELECT
  t.id,
  'pro',
  'manual',
  'manual',
  -- Included seats is irrelevant for manual grants; keep the schema happy.
  100,
  'Migrated from tenants.settings.features.pro on 2026-09-14'
FROM public.tenants t
WHERE coalesce((t.settings -> 'features' ->> 'pro')::boolean, true) = true
  AND NOT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.tenant_id = t.id
      AND s.product = 'pro'
      AND s.status IN ('trialing', 'active', 'past_due', 'manual')
  );

-- Make the old free-text tier column agree with the new table.
UPDATE public.tenants t
SET subscription_tier = 'pro'
WHERE EXISTS (
  SELECT 1 FROM public.subscriptions s
  WHERE s.tenant_id = t.id AND s.product = 'pro' AND s.status = 'manual'
);

-- Eyeball this: one row per tenant that should keep Pro.
SELECT t.name, s.product, s.status, s.source
FROM public.subscriptions s
JOIN public.tenants t ON t.id = s.tenant_id
ORDER BY t.name;
