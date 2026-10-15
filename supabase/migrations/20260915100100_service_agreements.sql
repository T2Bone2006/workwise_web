-- Service agreements: "clean the windows at 12 Elm Road every 4 weeks for £15".
--
-- Visits are ordinary public.jobs rows generated from these. next_due_date is
-- the generator's cursor: the next occurrence not yet turned into a job.
-- schedule_mode default fixed: generate-visits inserts every occurrence up
-- to horizon_weeks (default 8) and advances the cursor. Delay or skip does
-- not rewrite later dates. schedule_mode after_completion: complete creates
-- the next visit N days later (cron only backfills if that insert was missed).
-- UNIQUE(service_agreement_id, agreement_occurrence_date) on jobs (next
-- migration) makes generation idempotent.
--
-- Address lives here, not on the customer: one customer can have two
-- properties, or a house and a shop, each on its own cycle.

CREATE TABLE IF NOT EXISTS public.service_agreements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  service_catalog_id uuid,
  title text NOT NULL,
  address text NOT NULL,
  postcode text NOT NULL,
  lat numeric,
  lng numeric,
  price numeric(10,2) NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  frequency_days integer NOT NULL,
  -- First (or reference) visit date; the cursor starts here.
  anchor_date date NOT NULL,
  -- ISO weekday 1 = Monday .. 7 = Sunday. NULL = whatever the cycle lands on.
  preferred_weekday smallint,
  preferred_time time without time zone,
  -- 'fixed' (default) = every N days from the anchor, calendar dates.
  -- Delay or skip does not move later visits. 'after_completion' = N days
  -- after the previous visit was actually done.
  schedule_mode text NOT NULL DEFAULT 'fixed',
  next_due_date date NOT NULL,
  last_generated_at timestamp with time zone,
  status text NOT NULL DEFAULT 'active',
  -- Set with status = 'paused'. NULL = paused until manually resumed.
  paused_until date,
  ended_at timestamp with time zone,
  assigned_worker_id uuid,
  default_payment_method text,
  reminder_enabled boolean NOT NULL DEFAULT true,
  access_notes text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT service_agreements_pkey PRIMARY KEY (id),
  CONSTRAINT service_agreements_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT service_agreements_customer_id_fkey FOREIGN KEY (customer_id)
    REFERENCES public.customers(id) ON DELETE CASCADE,
  CONSTRAINT service_agreements_service_catalog_id_fkey FOREIGN KEY (service_catalog_id)
    REFERENCES public.service_catalog(id) ON DELETE SET NULL,
  CONSTRAINT service_agreements_assigned_worker_id_fkey FOREIGN KEY (assigned_worker_id)
    REFERENCES public.workers(id) ON DELETE SET NULL,
  CONSTRAINT service_agreements_price_check CHECK (price >= 0),
  CONSTRAINT service_agreements_duration_check CHECK (duration_minutes > 0),
  CONSTRAINT service_agreements_frequency_check CHECK (frequency_days BETWEEN 1 AND 365),
  CONSTRAINT service_agreements_preferred_weekday_check CHECK (
    preferred_weekday IS NULL OR preferred_weekday BETWEEN 1 AND 7
  ),
  CONSTRAINT service_agreements_schedule_mode_check CHECK (
    schedule_mode IN ('fixed', 'after_completion')
  ),
  CONSTRAINT service_agreements_status_check CHECK (status IN ('active', 'paused', 'ended')),
  CONSTRAINT service_agreements_default_payment_method_check CHECK (
    default_payment_method IS NULL
    OR default_payment_method IN ('cash', 'bank_transfer', 'card', 'cheque', 'other')
  )
);

COMMENT ON TABLE public.service_agreements IS
  'Recurring service at one address for one customer. Visits are jobs rows generated from the next_due_date cursor.';
COMMENT ON COLUMN public.service_agreements.next_due_date IS
  'Generator cursor: the next occurrence date that has not yet been inserted as a job.';
COMMENT ON COLUMN public.service_agreements.schedule_mode IS
  'fixed (default): calendar cadence from the anchor. after_completion: next visit from last completed date.';

CREATE INDEX IF NOT EXISTS idx_service_agreements_tenant_status_due
  ON public.service_agreements (tenant_id, status, next_due_date);
CREATE INDEX IF NOT EXISTS idx_service_agreements_customer_id
  ON public.service_agreements (customer_id);

DROP TRIGGER IF EXISTS service_agreements_set_updated_at ON public.service_agreements;
CREATE TRIGGER service_agreements_set_updated_at
  BEFORE UPDATE ON public.service_agreements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.service_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_agreements_tenant_select" ON public.service_agreements;
DROP POLICY IF EXISTS "service_agreements_admin_insert" ON public.service_agreements;
DROP POLICY IF EXISTS "service_agreements_admin_update" ON public.service_agreements;
DROP POLICY IF EXISTS "service_agreements_admin_delete" ON public.service_agreements;

-- Any login of the tenant may read (mobile Customers tab lists agreements).
CREATE POLICY "service_agreements_tenant_select"
ON public.service_agreements FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  OR tenant_id IN (SELECT primary_tenant_id FROM public.workers WHERE user_id = auth.uid())
);

CREATE POLICY "service_agreements_admin_insert"
ON public.service_agreements FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "service_agreements_admin_update"
ON public.service_agreements FOR UPDATE
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "service_agreements_admin_delete"
ON public.service_agreements FOR DELETE
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);
