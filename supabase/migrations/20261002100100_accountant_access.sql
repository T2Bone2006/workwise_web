-- Phase 5 migration 2: accountant access (D6, T7).
-- Paste after 20261002100000_expenses.
-- Service role only: RLS on, NO policies, nothing granted to anon/authenticated.
-- The trader's Settings panel reads through a server action that checks admin
-- first and then uses the service role. Raw tokens and codes are never stored.

CREATE TABLE IF NOT EXISTS public.accountant_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  email text NOT NULL,
  name text,
  link_token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  invited_by_user_id uuid,
  invited_at timestamp with time zone NOT NULL DEFAULT now(),
  last_viewed_at timestamp with time zone,
  removed_at timestamp with time zone,
  removed_by_user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT accountant_access_pkey PRIMARY KEY (id),
  CONSTRAINT accountant_access_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT accountant_access_invited_by_fkey FOREIGN KEY (invited_by_user_id)
    REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT accountant_access_removed_by_fkey FOREIGN KEY (removed_by_user_id)
    REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT accountant_access_status_check CHECK (status IN ('active', 'removed')),
  CONSTRAINT accountant_access_email_check CHECK (
    email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254 AND position('@' in email) > 1),
  CONSTRAINT accountant_access_name_check CHECK (name IS NULL OR char_length(name) <= 100),
  CONSTRAINT accountant_access_removed_check CHECK (
    (status = 'removed') = (removed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accountant_access_link_token
  ON public.accountant_access (link_token_hash);
-- One active invite per email per business; re-inviting after removal is a new row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_accountant_access_active_email
  ON public.accountant_access (tenant_id, email) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.accountant_login_codes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  access_id uuid NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT accountant_login_codes_pkey PRIMARY KEY (id),
  CONSTRAINT accountant_login_codes_access_fkey FOREIGN KEY (access_id)
    REFERENCES public.accountant_access(id) ON DELETE CASCADE,
  CONSTRAINT accountant_login_codes_attempts_check CHECK (attempts >= 0 AND attempts <= 5)
);
CREATE INDEX IF NOT EXISTS idx_accountant_login_codes_access_created
  ON public.accountant_login_codes (access_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.accountant_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  access_id uuid NOT NULL,
  session_token_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT accountant_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT accountant_sessions_access_fkey FOREIGN KEY (access_id)
    REFERENCES public.accountant_access(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_accountant_sessions_token
  ON public.accountant_sessions (session_token_hash);

DROP TRIGGER IF EXISTS set_accountant_access_updated_at ON public.accountant_access;
CREATE TRIGGER set_accountant_access_updated_at
  BEFORE UPDATE ON public.accountant_access
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.accountant_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accountant_login_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accountant_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.accountant_access FROM anon, authenticated;
REVOKE ALL ON public.accountant_login_codes FROM anon, authenticated;
REVOKE ALL ON public.accountant_sessions FROM anon, authenticated;

COMMENT ON TABLE public.accountant_access IS
  'D6: an accountant the trader invited. Read-only money view via /accountant/<token>. Only the SHA-256 of the link token is stored. Service role only.';
COMMENT ON TABLE public.accountant_login_codes IS
  'T7: 6-digit codes (HMAC-SHA256 with ACCOUNTANT_CODE_SECRET), 10 minutes, 5 tries. Service role only.';
COMMENT ON TABLE public.accountant_sessions IS
  'T7: 12-hour accountant sessions; the cookie holds the raw token, this holds its SHA-256. Service role only.';
