-- worker_tenants had RLS switched off entirely, so the default role grants
-- applied and the table was readable AND writable through the Data API by
-- anyone holding the anon key — no login required. That key is inlined into
-- the mobile bundle by EXPO_PUBLIC_SUPABASE_ANON_KEY and is therefore public.
--
-- The table carries hourly_rate and commission_rate, so that exposed every
-- worker's pay, across every tenant rather than one.
--
-- Policies mirror the shape already used on public.workers, so office logins
-- and admins behave exactly as they do today.
--
-- Verified against every caller first: worker_tenants is touched only from
-- workwise_web (SELECT/INSERT/UPDATE/DELETE in lib/actions/workers.ts,
-- lib/actions/settings.ts, lib/actions/jobs.ts and the workers detail page,
-- all under the user-session client as an admin). The mobile app never
-- queries it, and the marketing site never touches it.

ALTER TABLE public.worker_tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage worker_tenants" ON public.worker_tenants;
DROP POLICY IF EXISTS "Users can view own tenant worker_tenants" ON public.worker_tenants;
DROP POLICY IF EXISTS "Workers can view own worker_tenants rows" ON public.worker_tenants;

-- Covers the dashboard's inserts, updates and deletes as well as its reads.
CREATE POLICY "Admins can manage worker_tenants"
ON public.worker_tenants
FOR ALL
USING (
  tenant_id IN (
    SELECT users.tenant_id
    FROM public.users
    WHERE users.id = auth.uid()
      AND users.role = 'admin'
  )
)
WITH CHECK (
  tenant_id IN (
    SELECT users.tenant_id
    FROM public.users
    WHERE users.id = auth.uid()
      AND users.role = 'admin'
  )
);

-- Non-admin office logins get the same read access they have on workers.
CREATE POLICY "Users can view own tenant worker_tenants"
ON public.worker_tenants
FOR SELECT
USING (
  tenant_id IN (
    SELECT users.tenant_id
    FROM public.users
    WHERE users.id = auth.uid()
      AND users.role IS DISTINCT FROM 'worker'
  )
);

-- A worker sees only their own membership rows, and so only their own pay.
-- Nothing needs this today — the app never reads the table — but the planned
-- move to resolving accessible tenants from worker_tenants will.
CREATE POLICY "Workers can view own worker_tenants rows"
ON public.worker_tenants
FOR SELECT
USING (
  worker_id IN (
    SELECT workers.id
    FROM public.workers
    WHERE workers.user_id = auth.uid()
  )
);
