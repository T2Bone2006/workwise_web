-- Phase 5 migration 1: expenses (what the business spent) + private receipt photos.
-- Paste after 20261001120000_visit_changes_swap_days (and Phase 4's 20260930100300_more_ways_to_pay).
-- D2 fixed categories; T1 draft/confirmed; T2 amount incl. VAT; T4 idempotent creates.
-- Additive only. Admin-only RLS; the phone uses bearer routes that check admin first.

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  spent_on date,
  merchant text,
  category text,
  amount numeric(10,2),
  vat_amount numeric(10,2),
  note text,
  receipt_path text,
  receipt_mime text,
  source text NOT NULL DEFAULT 'manual',
  ai_extracted jsonb,
  ai_confidence numeric(3,2),
  ai_model text,
  client_mutation_id text,
  created_by_user_id uuid,
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT expenses_pkey PRIMARY KEY (id),
  CONSTRAINT expenses_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by_user_id)
    REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT expenses_status_check CHECK (status IN ('draft', 'confirmed')),
  CONSTRAINT expenses_source_check CHECK (source IN ('receipt_scan', 'manual')),
  CONSTRAINT expenses_category_check CHECK (category IS NULL OR category IN (
    'vehicle', 'equipment', 'supplies', 'phone', 'insurance',
    'advertising', 'fees', 'wages', 'other')),
  CONSTRAINT expenses_amount_check CHECK (amount IS NULL OR (amount > 0 AND amount <= 100000)),
  CONSTRAINT expenses_vat_check CHECK (
    vat_amount IS NULL OR (vat_amount >= 0 AND (amount IS NULL OR vat_amount <= amount))),
  CONSTRAINT expenses_confidence_check CHECK (
    ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  CONSTRAINT expenses_merchant_check CHECK (merchant IS NULL OR char_length(merchant) <= 120),
  CONSTRAINT expenses_note_check CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT expenses_confirmed_complete_check CHECK (
    status = 'draft'
    OR (spent_on IS NOT NULL AND amount IS NOT NULL AND category IS NOT NULL
        AND confirmed_at IS NOT NULL)),
  CONSTRAINT expenses_scan_has_photo_check CHECK (
    source <> 'receipt_scan' OR receipt_path IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_tenant_client_mutation
  ON public.expenses (tenant_id, client_mutation_id)
  WHERE client_mutation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_status_spent
  ON public.expenses (tenant_id, status, spent_on DESC);

DROP TRIGGER IF EXISTS set_expenses_updated_at ON public.expenses;
CREATE TRIGGER set_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_admin_select" ON public.expenses;
DROP POLICY IF EXISTS "expenses_admin_insert" ON public.expenses;
DROP POLICY IF EXISTS "expenses_admin_update" ON public.expenses;
DROP POLICY IF EXISTS "expenses_admin_delete" ON public.expenses;

CREATE POLICY "expenses_admin_select" ON public.expenses FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "expenses_admin_insert" ON public.expenses FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "expenses_admin_update" ON public.expenses FOR UPDATE TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'))
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "expenses_admin_delete" ON public.expenses FOR DELETE TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'));

REVOKE ALL ON public.expenses FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;

COMMENT ON TABLE public.expenses IS
  'Money the business spent (Phase 5). draft = To check (made by a receipt scan, never counted); confirmed = counted. amount includes VAT.';
COMMENT ON COLUMN public.expenses.category IS
  'D2 fixed keys: vehicle, equipment, supplies, phone, insurance, advertising, fees, wages, other.';
COMMENT ON COLUMN public.expenses.receipt_path IS
  'Path in the private expense-receipts bucket: <tenant_id>/<expense_id>.<ext>.';
COMMENT ON COLUMN public.expenses.client_mutation_id IS
  'Idempotency key from the phone outbox or the dashboard dialog; a replay returns the existing row.';

-- ---------------------------------------------------------------------------
-- Private receipts bucket: admin of the tenant folder only. Accountant pages
-- read with the service role and hand out short signed URLs.
--   expense-receipts/<tenant_id>/<expense_id>.<ext>
-- 8 MB max; JPEG/PNG/WEBP/PDF only (HEIC is refused before upload, T6).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('expense-receipts', 'expense-receipts', false, 8388608,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "expense_receipts_admin_select" ON storage.objects;
DROP POLICY IF EXISTS "expense_receipts_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "expense_receipts_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "expense_receipts_admin_delete" ON storage.objects;

CREATE POLICY "expense_receipts_admin_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'expense-receipts'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "expense_receipts_admin_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'expense-receipts'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "expense_receipts_admin_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'expense-receipts'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid() AND role = 'admin'
  )
)
WITH CHECK (
  bucket_id = 'expense-receipts'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "expense_receipts_admin_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'expense-receipts'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid() AND role = 'admin'
  )
);
