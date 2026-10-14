-- Phase 9 (Rounds team), file 1 of 3. Paste after the worker-web files
-- (20261008100000, 20261008100100, 20261008100200). Spec: docs/specs/phase-9/03-migration-team-tables.md
--
-- What this adds (all additive, safe to paste twice):
--   team_people     the leads (a login) and helpers (just a name) on a Rounds business, with a day rate and usual days
--   work_days       who worked on which date, at what rate (what pay is worked out from)
--   team_payments   what the owner has paid each person (a note of it; the app never pays anyone)
--   team_days_off   a lead's (or the owner's) days off
--   rounds.usual_lead_worker_id      who normally does a round
--   customers.added_by_worker_id     which member of staff added a customer, and when the owner checked it
--   visit_changes: two new kinds, 'reassign' (a round given to someone) and 'push_back' (a round slid along)
--   record_team_payment / void_team_payment: write a payment and its 'wages' expense together or not at all
--
-- Staff (users.role = 'worker') get NO policy on the four new tables: only the owner (role 'admin') can read or
-- write them from the app. The server code uses the service role for staff-facing reads.
--
-- To undo (history only; this is not run by the app):
--   DROP FUNCTION IF EXISTS public.void_team_payment(uuid, uuid, uuid);
--   DROP FUNCTION IF EXISTS public.record_team_payment(uuid, uuid, integer, date, text, text, uuid);
--   DROP TABLE IF EXISTS public.team_days_off, public.team_payments, public.work_days, public.team_people;
--   ALTER TABLE public.rounds DROP COLUMN IF EXISTS usual_lead_worker_id;
--   ALTER TABLE public.customers DROP COLUMN IF EXISTS added_by_worker_id, DROP COLUMN IF EXISTS added_checked_at;

BEGIN;

-- ---------------------------------------------------------------------------
-- team_people

CREATE TABLE IF NOT EXISTS public.team_people (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL,
  worker_id uuid,
  name text NOT NULL,
  day_rate_pence integer NOT NULL DEFAULT 0,
  usual_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_people_pkey PRIMARY KEY (id),
  CONSTRAINT team_people_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT team_people_worker_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE SET NULL,
  CONSTRAINT team_people_kind_check CHECK (kind IN ('lead', 'helper')),
  CONSTRAINT team_people_helper_no_worker CHECK (kind = 'lead' OR worker_id IS NULL),
  CONSTRAINT team_people_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT team_people_rate_check CHECK (day_rate_pence BETWEEN 0 AND 100000),
  CONSTRAINT team_people_days_check CHECK (usual_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[])
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_people_worker
  ON public.team_people (worker_id) WHERE worker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_people_tenant
  ON public.team_people (tenant_id) WHERE ended_at IS NULL;

COMMENT ON TABLE public.team_people IS
  'Phase 9: a lead (kind lead, has a workers row and a login) or a helper (kind helper, a name only, never a workers row) on a Rounds business.';

-- ---------------------------------------------------------------------------
-- work_days

CREATE TABLE IF NOT EXISTS public.work_days (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_date date NOT NULL,
  person_id uuid NOT NULL,
  role text NOT NULL,
  rate_pence integer NOT NULL,
  source text NOT NULL DEFAULT 'start_day',
  with_person_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_days_pkey PRIMARY KEY (id),
  CONSTRAINT work_days_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT work_days_person_fkey FOREIGN KEY (person_id) REFERENCES public.team_people(id) ON DELETE CASCADE,
  CONSTRAINT work_days_with_fkey FOREIGN KEY (with_person_id) REFERENCES public.team_people(id) ON DELETE SET NULL,
  CONSTRAINT work_days_role_check CHECK (role IN ('lead', 'helper')),
  CONSTRAINT work_days_source_check CHECK (source IN ('start_day', 'manual')),
  CONSTRAINT work_days_rate_check CHECK (rate_pence BETWEEN 0 AND 100000),
  CONSTRAINT work_days_note_check CHECK (note IS NULL OR char_length(note) <= 300),
  CONSTRAINT uq_work_days_person_date UNIQUE (tenant_id, work_date, person_id)
);

CREATE INDEX IF NOT EXISTS idx_work_days_person_date
  ON public.work_days (tenant_id, person_id, work_date);

COMMENT ON COLUMN public.work_days.with_person_id IS
  'For a helper''s day, the lead they went out with (NULL = went out with the owner, or this is a lead''s own row).';
COMMENT ON COLUMN public.work_days.rate_pence IS
  'The rate on the day, copied when the day was recorded. Changing a person''s rate later never rewrites old days.';

-- ---------------------------------------------------------------------------
-- team_payments

CREATE TABLE IF NOT EXISTS public.team_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  person_id uuid NOT NULL,
  amount_pence integer NOT NULL,
  paid_on date NOT NULL,
  note text,
  expense_id uuid,
  client_mutation_id text,
  created_by_user_id uuid,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_payments_pkey PRIMARY KEY (id),
  CONSTRAINT team_payments_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT team_payments_person_fkey FOREIGN KEY (person_id) REFERENCES public.team_people(id) ON DELETE CASCADE,
  CONSTRAINT team_payments_expense_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE SET NULL,
  CONSTRAINT team_payments_user_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id),
  CONSTRAINT team_payments_amount_check CHECK (amount_pence > 0 AND amount_pence <= 10000000),
  CONSTRAINT team_payments_note_check CHECK (note IS NULL OR char_length(note) <= 300)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_payments_mutation
  ON public.team_payments (tenant_id, client_mutation_id) WHERE client_mutation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_team_payments_person
  ON public.team_payments (tenant_id, person_id, paid_on);

COMMENT ON TABLE public.team_payments IS
  'Phase 9: a note of what the owner paid a team member. The app never pays anyone. Each row has a matching wages expense (expense_id).';

-- ---------------------------------------------------------------------------
-- team_days_off

CREATE TABLE IF NOT EXISTS public.team_days_off (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_days_off_pkey PRIMARY KEY (id),
  CONSTRAINT team_days_off_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT team_days_off_worker_fkey FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE,
  CONSTRAINT team_days_off_range_check CHECK (to_date >= from_date AND to_date - from_date <= 120),
  CONSTRAINT team_days_off_note_check CHECK (note IS NULL OR char_length(note) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_team_days_off_worker
  ON public.team_days_off (tenant_id, worker_id, from_date);

-- ---------------------------------------------------------------------------
-- Row security: the owner of the business only. Staff (role 'worker') get no policy.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_people', 'work_days', 'team_payments', 'team_days_off'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = ''admin''))',
      t || '_admin_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = ''admin''))',
      t || '_admin_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = ''admin'')) WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = ''admin''))',
      t || '_admin_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = ''admin''))',
      t || '_admin_delete', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- rounds.usual_lead_worker_id

ALTER TABLE public.rounds ADD COLUMN IF NOT EXISTS usual_lead_worker_id uuid;
ALTER TABLE public.rounds DROP CONSTRAINT IF EXISTS rounds_usual_lead_fkey;
ALTER TABLE public.rounds ADD CONSTRAINT rounds_usual_lead_fkey
  FOREIGN KEY (usual_lead_worker_id) REFERENCES public.workers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.rounds.usual_lead_worker_id IS
  'Who normally does this round (a lead, or the owner''s own worker row). New visits for the round are given to them; any person can still be put on the round for a day.';

-- ---------------------------------------------------------------------------
-- customers: added by a member of staff, and checked by the owner

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS added_by_worker_id uuid;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS added_checked_at timestamptz;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_added_by_fkey;
ALTER TABLE public.customers ADD CONSTRAINT customers_added_by_fkey
  FOREIGN KEY (added_by_worker_id) REFERENCES public.workers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_added_unchecked
  ON public.customers (tenant_id)
  WHERE added_by_worker_id IS NOT NULL AND added_checked_at IS NULL;

-- ---------------------------------------------------------------------------
-- visit_changes: 'reassign' and 'push_back'

ALTER TABLE public.visit_changes DROP CONSTRAINT IF EXISTS visit_changes_kind_check;
ALTER TABLE public.visit_changes ADD CONSTRAINT visit_changes_kind_check CHECK (
  kind IN ('skip', 'reschedule', 'move_remaining', 'skip_remaining', 'swap_days', 'reassign', 'push_back')
);

ALTER TABLE public.visit_changes DROP CONSTRAINT IF EXISTS visit_changes_dates_check;
ALTER TABLE public.visit_changes ADD CONSTRAINT visit_changes_dates_check CHECK (
  (kind IN ('reschedule', 'move_remaining') AND to_date IS NOT NULL)
  OR (
    kind = 'swap_days'
    AND from_date IS NOT NULL
    AND to_date IS NOT NULL
    AND from_date <> to_date
  )
  OR (kind IN ('reassign', 'push_back') AND from_date IS NOT NULL)
  OR kind IN ('skip', 'skip_remaining')
);

COMMENT ON COLUMN public.visit_changes.kind IS
  'skip | reschedule | move_remaining | skip_remaining | swap_days | reassign | push_back. swap_days: from_date = day dragged, to_date = day dropped on. reassign: from_date = the day whose visits were given to someone else. push_back: from_date = first day off, to_date = the latest day a visit was moved to.';

-- ---------------------------------------------------------------------------
-- record_team_payment / void_team_payment (service role only)

CREATE OR REPLACE FUNCTION public.record_team_payment(
  p_tenant_id uuid,
  p_person_id uuid,
  p_amount_pence integer,
  p_paid_on date,
  p_note text,
  p_client_mutation_id text,
  p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_name text;
  v_expense uuid;
  v_id uuid;
BEGIN
  IF p_client_mutation_id IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM public.team_payments
    WHERE tenant_id = p_tenant_id AND client_mutation_id = p_client_mutation_id;
    IF FOUND THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT name INTO v_name
  FROM public.team_people
  WHERE id = p_person_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'person_not_found';
  END IF;

  IF p_amount_pence IS NULL OR p_amount_pence < 1 OR p_amount_pence > 10000000 THEN
    RAISE EXCEPTION 'bad_amount';
  END IF;

  BEGIN
    INSERT INTO public.expenses (
      tenant_id, status, spent_on, merchant, category, amount, note, source,
      created_by_user_id, confirmed_at
    ) VALUES (
      p_tenant_id, 'confirmed', p_paid_on, left(v_name, 120), 'wages',
      p_amount_pence::numeric / 100, NULLIF(left(coalesce(p_note, ''), 500), ''), 'manual',
      p_user_id, now()
    )
    RETURNING id INTO v_expense;

    INSERT INTO public.team_payments (
      tenant_id, person_id, amount_pence, paid_on, note, expense_id, client_mutation_id, created_by_user_id
    ) VALUES (
      p_tenant_id, p_person_id, p_amount_pence, p_paid_on, NULLIF(left(coalesce(p_note, ''), 300), ''),
      v_expense, p_client_mutation_id, p_user_id
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- A second request with the same key got here first; its expense and payment are the ones that count.
    SELECT id INTO v_existing
    FROM public.team_payments
    WHERE tenant_id = p_tenant_id AND client_mutation_id = p_client_mutation_id;
    IF FOUND THEN
      RETURN v_existing;
    END IF;
    RAISE;
  END;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_team_payment(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense uuid;
  v_found boolean := false;
BEGIN
  UPDATE public.team_payments
  SET voided_at = now()
  WHERE id = p_payment_id AND tenant_id = p_tenant_id AND voided_at IS NULL
  RETURNING expense_id INTO v_expense;
  v_found := FOUND;

  IF NOT v_found THEN
    RETURN false;
  END IF;

  IF v_expense IS NOT NULL THEN
    DELETE FROM public.expenses WHERE id = v_expense AND tenant_id = p_tenant_id;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_team_payment(uuid, uuid, integer, date, text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_team_payment(uuid, uuid, integer, date, text, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.void_team_payment(uuid, uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_team_payment(uuid, uuid, uuid) TO service_role;

COMMIT;

-- Checks (run after pasting; each should return what the comment says):
-- 1. The four tables exist → 4 rows
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name IN ('team_people','work_days','team_payments','team_days_off');
-- 2. Security is on for all four → 4 rows, all true
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE relname IN ('team_people','work_days','team_payments','team_days_off') AND relkind = 'r';
-- 3. The new kinds are allowed and nothing existing breaks → first mentions 'push_back'; second returns 0
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'visit_changes_kind_check';
-- SELECT count(*) FROM public.visit_changes
--  WHERE kind NOT IN ('skip','reschedule','move_remaining','skip_remaining','swap_days','reassign','push_back');
-- 4. The new columns exist → 3 rows
-- SELECT table_name, column_name FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND ((table_name = 'rounds' AND column_name = 'usual_lead_worker_id')
--      OR (table_name = 'customers' AND column_name IN ('added_by_worker_id', 'added_checked_at')));
-- 5. The functions are locked to the service role → 2 rows, none for 'authenticated' or 'anon'
-- SELECT routine_name, grantee FROM information_schema.routine_privileges
--  WHERE routine_name IN ('record_team_payment','void_team_payment') AND grantee IN ('authenticated','anon','service_role');
