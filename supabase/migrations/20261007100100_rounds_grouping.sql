-- Named rounds: a way to group a business's regular places ("Tuesday north",
-- "The village") so the map and the customer list can be filtered by them.
--
-- A round holds PLACES (service_agreements), not customers: one customer can
-- have a house and a shop in two different rounds. A place is in at most one
-- round. Rounds are for seeing and organising only; they do not change how
-- days are put together.
--
-- The round's area on the map is worked out from its places, so no shape is
-- stored here.
--
-- Deleting a round does not touch the places in it; they simply become
-- "not in a round" again.
--
-- To undo (history only; this is not run by the app):
--   ALTER TABLE public.service_agreements DROP COLUMN IF EXISTS round_id;
--   DROP TABLE IF EXISTS public.rounds;

CREATE TABLE IF NOT EXISTS public.rounds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  -- Hex colour picked from the app's palette, e.g. '#7c3aed'.
  colour text NOT NULL DEFAULT '#7c3aed',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT rounds_pkey PRIMARY KEY (id),
  CONSTRAINT rounds_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT rounds_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT rounds_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT rounds_colour_check CHECK (colour ~ '^#[0-9a-fA-F]{6}$')
);

COMMENT ON TABLE public.rounds IS
  'A named group of a business''s places (service_agreements), for the map and filters. Organising only.';

-- One round per name within a business, ignoring capitals and spaces at the ends.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rounds_tenant_name
  ON public.rounds (tenant_id, lower(btrim(name)));

DROP TRIGGER IF EXISTS rounds_set_updated_at ON public.rounds;
CREATE TRIGGER rounds_set_updated_at
  BEFORE UPDATE ON public.rounds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.service_agreements
  ADD COLUMN IF NOT EXISTS round_id uuid;

-- The round must belong to the same business as the place. When a round is
-- deleted only round_id is cleared (tenant_id stays; that needs Postgres 15+).
ALTER TABLE public.service_agreements
  DROP CONSTRAINT IF EXISTS service_agreements_round_fkey;
ALTER TABLE public.service_agreements
  ADD CONSTRAINT service_agreements_round_fkey FOREIGN KEY (round_id, tenant_id)
    REFERENCES public.rounds (id, tenant_id) ON DELETE SET NULL (round_id);

COMMENT ON COLUMN public.service_agreements.round_id IS
  'The named round this place is in, if any. NULL = not in a round.';

CREATE INDEX IF NOT EXISTS idx_service_agreements_round_id
  ON public.service_agreements (round_id)
  WHERE round_id IS NOT NULL;

-- Same shape as service_agreements: any login of the business may read, only
-- the admin (the business owner) may change.
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rounds_tenant_select" ON public.rounds;
DROP POLICY IF EXISTS "rounds_admin_insert" ON public.rounds;
DROP POLICY IF EXISTS "rounds_admin_update" ON public.rounds;
DROP POLICY IF EXISTS "rounds_admin_delete" ON public.rounds;

CREATE POLICY "rounds_tenant_select"
ON public.rounds FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  OR tenant_id IN (SELECT primary_tenant_id FROM public.workers WHERE user_id = auth.uid())
);

CREATE POLICY "rounds_admin_insert"
ON public.rounds FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "rounds_admin_update"
ON public.rounds FOR UPDATE
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "rounds_admin_delete"
ON public.rounds FOR DELETE
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);
