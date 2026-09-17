-- Service catalog: the named services a Rounds tenant sells (window clean,
-- gutter clear, lawn cut, ...). An agreement points at one row for defaults,
-- but price/duration/frequency are COPIED onto the agreement, so editing the
-- catalog never rewrites live agreements or generated visits.

CREATE TABLE IF NOT EXISTS public.service_catalog (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  default_price numeric(10,2) NOT NULL DEFAULT 0,
  default_duration_minutes integer NOT NULL DEFAULT 30,
  -- NULL = one-off service with no natural repeat.
  default_frequency_days integer,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT service_catalog_pkey PRIMARY KEY (id),
  CONSTRAINT service_catalog_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT service_catalog_tenant_name_key UNIQUE (tenant_id, name),
  CONSTRAINT service_catalog_price_check CHECK (default_price >= 0),
  CONSTRAINT service_catalog_duration_check CHECK (default_duration_minutes > 0),
  CONSTRAINT service_catalog_frequency_check CHECK (
    default_frequency_days IS NULL OR default_frequency_days BETWEEN 1 AND 365
  )
);

COMMENT ON TABLE public.service_catalog IS
  'Services a Rounds tenant offers. Defaults only; agreements copy the values.';

CREATE INDEX IF NOT EXISTS idx_service_catalog_tenant_id
  ON public.service_catalog (tenant_id);

DROP TRIGGER IF EXISTS service_catalog_set_updated_at ON public.service_catalog;
CREATE TRIGGER service_catalog_set_updated_at
  BEFORE UPDATE ON public.service_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.service_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_catalog_tenant_select" ON public.service_catalog;
DROP POLICY IF EXISTS "service_catalog_admin_insert" ON public.service_catalog;
DROP POLICY IF EXISTS "service_catalog_admin_update" ON public.service_catalog;
DROP POLICY IF EXISTS "service_catalog_admin_delete" ON public.service_catalog;

-- Any login of the tenant may read (the mobile app shows service names).
CREATE POLICY "service_catalog_tenant_select"
ON public.service_catalog FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  OR tenant_id IN (SELECT primary_tenant_id FROM public.workers WHERE user_id = auth.uid())
);

CREATE POLICY "service_catalog_admin_insert"
ON public.service_catalog FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "service_catalog_admin_update"
ON public.service_catalog FOR UPDATE
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "service_catalog_admin_delete"
ON public.service_catalog FOR DELETE
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);
