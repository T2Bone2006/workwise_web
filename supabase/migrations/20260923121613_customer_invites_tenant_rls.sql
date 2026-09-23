-- Allow tenant office users to manage their own customer portal invites.
-- Previously only the service_role policy existed, so the Portal Invites tab
-- always appeared empty for authenticated users.

ALTER TABLE public.customer_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_invites_tenant_select" ON public.customer_invites;
DROP POLICY IF EXISTS "customer_invites_tenant_insert" ON public.customer_invites;
DROP POLICY IF EXISTS "customer_invites_tenant_update" ON public.customer_invites;
DROP POLICY IF EXISTS "customer_invites_tenant_delete" ON public.customer_invites;

CREATE POLICY "customer_invites_tenant_select"
ON public.customer_invites FOR SELECT
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
);

CREATE POLICY "customer_invites_tenant_insert"
ON public.customer_invites FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
);

CREATE POLICY "customer_invites_tenant_update"
ON public.customer_invites FOR UPDATE
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
)
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
);

CREATE POLICY "customer_invites_tenant_delete"
ON public.customer_invites FOR DELETE
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  )
);
