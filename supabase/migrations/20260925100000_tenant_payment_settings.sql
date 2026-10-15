-- Phase 2 (payments), file 1 of 4. Paste before 20260925100100.
--
-- tenant_payment_settings: one row per business with how that business gets
-- paid — bank details printed on the pay page and invoices, VAT, invoice
-- numbering, and a mirror of its Stripe Connect status.
--
-- Why not columns on tenants: live RLS lets workers, customer-portal users
-- and every network-connected tenant (policy tenants_read_for_network)
-- SELECT a tenants row. Bank details must never be readable by another
-- business, so they live here, readable only by this tenant's admins. The
-- public pay page reads this table with the service role, server-side.
--
-- Column-level grants: a logged-in admin may write only the fields they own
-- (bank, VAT, invoice wording). The invoice counter and the Stripe mirror
-- are written only by SECURITY DEFINER functions or the service role, so a
-- tenant cannot fake "card payments on" or rewind its invoice numbers.
--
-- The row is created lazily: the app inserts (tenant_id) on first save, then
-- updates. create_invoice() also inserts it if missing.

CREATE TABLE IF NOT EXISTS public.tenant_payment_settings (
  tenant_id uuid NOT NULL,
  bank_account_name text,
  -- Digits only, no dashes: '123456' / '12345678'. The UI formats 12-34-56.
  bank_sort_code text,
  bank_account_number text,
  vat_registered boolean NOT NULL DEFAULT false,
  vat_number text,
  vat_rate_percent numeric(5,2) NOT NULL DEFAULT 20,
  invoice_due_days integer NOT NULL DEFAULT 14,
  invoice_prefix text NOT NULL DEFAULT 'INV',
  -- Next number create_invoice() will hand out. Never written by the app.
  next_invoice_seq integer NOT NULL DEFAULT 1,
  invoice_footer text,
  -- Mirror of the Stripe connected account, written by the server only.
  stripe_connect_charges_enabled boolean NOT NULL DEFAULT false,
  stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false,
  stripe_connect_details_submitted boolean NOT NULL DEFAULT false,
  stripe_connect_requirements_due text[] NOT NULL DEFAULT '{}'::text[],
  stripe_connect_disabled_reason text,
  stripe_connect_synced_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tenant_payment_settings_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT tenant_payment_settings_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT tps_sort_code_check CHECK (
    bank_sort_code IS NULL OR bank_sort_code ~ '^[0-9]{6}$'
  ),
  CONSTRAINT tps_account_number_check CHECK (
    bank_account_number IS NULL OR bank_account_number ~ '^[0-9]{8}$'
  ),
  CONSTRAINT tps_account_name_check CHECK (
    bank_account_name IS NULL OR char_length(btrim(bank_account_name)) BETWEEN 1 AND 70
  ),
  CONSTRAINT tps_vat_number_check CHECK (
    NOT vat_registered
    OR (vat_number IS NOT NULL AND char_length(btrim(vat_number)) BETWEEN 5 AND 20)
  ),
  CONSTRAINT tps_vat_rate_check CHECK (vat_rate_percent >= 0 AND vat_rate_percent <= 100),
  CONSTRAINT tps_due_days_check CHECK (invoice_due_days BETWEEN 0 AND 90),
  CONSTRAINT tps_prefix_check CHECK (invoice_prefix ~ '^[A-Z0-9]{1,10}$'),
  CONSTRAINT tps_seq_check CHECK (next_invoice_seq >= 1),
  CONSTRAINT tps_footer_check CHECK (
    invoice_footer IS NULL OR char_length(invoice_footer) <= 500
  )
);

COMMENT ON TABLE public.tenant_payment_settings IS
  'How a business gets paid: bank details, VAT, invoice numbering, Stripe Connect mirror. Admin-only; never on tenants (network tenants can read tenants rows).';

DROP TRIGGER IF EXISTS tenant_payment_settings_set_updated_at ON public.tenant_payment_settings;
CREATE TRIGGER tenant_payment_settings_set_updated_at
  BEFORE UPDATE ON public.tenant_payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tenant_payment_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tps_admin_select" ON public.tenant_payment_settings;
DROP POLICY IF EXISTS "tps_admin_insert" ON public.tenant_payment_settings;
DROP POLICY IF EXISTS "tps_admin_update" ON public.tenant_payment_settings;

-- Admins only. Workers (a Pro tenant's staff) never see bank details.
CREATE POLICY "tps_admin_select"
ON public.tenant_payment_settings FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "tps_admin_insert"
ON public.tenant_payment_settings FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "tps_admin_update"
ON public.tenant_payment_settings FOR UPDATE
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

-- Column-level privileges. Supabase grants ALL on new public tables to anon
-- and authenticated by default; narrow that. No DELETE for anyone but the
-- service role.
REVOKE ALL ON public.tenant_payment_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.tenant_payment_settings FROM authenticated;
GRANT SELECT ON public.tenant_payment_settings TO authenticated;
GRANT INSERT (
  tenant_id, bank_account_name, bank_sort_code, bank_account_number,
  vat_registered, vat_number, invoice_due_days, invoice_prefix, invoice_footer
) ON public.tenant_payment_settings TO authenticated;
GRANT UPDATE (
  bank_account_name, bank_sort_code, bank_account_number,
  vat_registered, vat_number, invoice_due_days, invoice_prefix, invoice_footer
) ON public.tenant_payment_settings TO authenticated;

-- ---------------------------------------------------------------------------
-- business-assets: each business's own logo (and later other branding).
-- Public read, because the logo must load inside customer emails and on the
-- public pay page. A logo is not secret. Writes: only an admin of the
-- business, only inside the folder named after their tenant id:
--   business-assets/<tenant_id>/logo-<timestamp>.png
-- PNG/JPEG only (the PDF renderer cannot draw SVG/WebP), 2 MB max.
-- WorkWise's own `assets` bucket is not used for customer files.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('business-assets', 'business-assets', true, 2097152, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "business_assets_admin_select" ON storage.objects;
DROP POLICY IF EXISTS "business_assets_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "business_assets_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "business_assets_admin_delete" ON storage.objects;

-- SELECT is needed for upsert/overwrite and for listing; public URLs work
-- without it because the bucket is public.
CREATE POLICY "business_assets_admin_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'business-assets'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "business_assets_admin_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'business-assets'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "business_assets_admin_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'business-assets'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid() AND role = 'admin'
  )
)
WITH CHECK (
  bucket_id = 'business-assets'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "business_assets_admin_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'business-assets'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid() AND role = 'admin'
  )
);
