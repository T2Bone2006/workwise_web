-- Phase 5 migration 3: "Stuck? Send us your file" (D9, T15) + import file fingerprint (T13).
-- Paste after 20261002100100_accountant_access.
-- Additive only. Pro's import keeps working: the two new import_history columns are nullable.

CREATE TABLE IF NOT EXISTS public.setup_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  requested_by_user_id uuid,
  note text,
  file_paths text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open',
  emailed_at timestamp with time zone,
  closed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT setup_requests_pkey PRIMARY KEY (id),
  CONSTRAINT setup_requests_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT setup_requests_user_fkey FOREIGN KEY (requested_by_user_id)
    REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT setup_requests_status_check CHECK (status IN ('open', 'done')),
  CONSTRAINT setup_requests_note_check CHECK (note IS NULL OR char_length(note) <= 2000),
  CONSTRAINT setup_requests_files_check CHECK (cardinality(file_paths) <= 5)
);
CREATE INDEX IF NOT EXISTS idx_setup_requests_tenant_created
  ON public.setup_requests (tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS set_setup_requests_updated_at ON public.setup_requests;
CREATE TRIGGER set_setup_requests_updated_at
  BEFORE UPDATE ON public.setup_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.setup_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "setup_requests_admin_select" ON public.setup_requests;
CREATE POLICY "setup_requests_admin_select" ON public.setup_requests FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'));
-- Inserts and updates are service role only (the action checks admin, uploads, then inserts).
REVOKE ALL ON public.setup_requests FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.setup_requests FROM authenticated;
GRANT SELECT ON public.setup_requests TO authenticated;

COMMENT ON TABLE public.setup_requests IS
  'D9: "Stuck? Send us your file". Files in the private setup-requests bucket; the WorkWise owner is emailed signed links. One open request per business per 30 days (enforced in the app).';

-- Private bucket: setup-requests/<tenant_id>/<request_id>/<file>. 10 MB max.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('setup-requests', 'setup-requests', false, 10485760, ARRAY[
  'text/csv', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
-- No storage.objects policies: uploads and signed URLs use the service role only.

-- ---------------------------------------------------------------------------
-- Import file fingerprint (Rounds import). Existing rows stay NULL = Pro.

ALTER TABLE public.import_history ADD COLUMN IF NOT EXISTS file_sha256 text;
ALTER TABLE public.import_history ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE public.import_history DROP CONSTRAINT IF EXISTS import_history_kind_check;
ALTER TABLE public.import_history ADD CONSTRAINT import_history_kind_check
  CHECK (kind IS NULL OR kind IN ('rounds_customers'));
CREATE INDEX IF NOT EXISTS idx_import_history_tenant_sha
  ON public.import_history (tenant_id, file_sha256) WHERE file_sha256 IS NOT NULL;
COMMENT ON COLUMN public.import_history.file_sha256 IS
  'T13: SHA-256 of the uploaded file (Rounds import) so the same file warns "You imported this on …".';
COMMENT ON COLUMN public.import_history.kind IS
  'NULL = Pro job import (unchanged). rounds_customers = Phase 5 Rounds import.';
