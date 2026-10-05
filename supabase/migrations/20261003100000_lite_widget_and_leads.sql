-- Phase 6 migration 1: Lite widget security, leads for instant accept, usage limits, one-tap links.
-- D2 website lock + limits; D6/D7 follow-up + instant accept; D9 board columns; T5 limits; T10 lead fields; T11 tokens.
-- Additive except the copy of widget_leads into leads (insert only). Public widget routes use the
-- service role; dashboard users get SELECT only — every write goes through server cores.

-- 1. widget_clients: one widget per business, the tradie's texting details ------------------------
ALTER TABLE public.widget_clients
  ADD COLUMN IF NOT EXISTS sign_off_name text,
  ADD COLUMN IF NOT EXISTS owner_mobile_e164 text,
  ADD COLUMN IF NOT EXISTS follow_up_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS text_me_too boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS website_url text;

ALTER TABLE public.widget_clients DROP CONSTRAINT IF EXISTS widget_clients_sign_off_check;
ALTER TABLE public.widget_clients ADD CONSTRAINT widget_clients_sign_off_check
  CHECK (sign_off_name IS NULL OR char_length(sign_off_name) BETWEEN 1 AND 40);
ALTER TABLE public.widget_clients DROP CONSTRAINT IF EXISTS widget_clients_owner_mobile_check;
ALTER TABLE public.widget_clients ADD CONSTRAINT widget_clients_owner_mobile_check
  CHECK (owner_mobile_e164 IS NULL OR owner_mobile_e164 ~ '^\+447[0-9]{9}$');
-- D2: one website (the www. version is allowed in code). NOT VALID: WorkWise's own row may list more today.
ALTER TABLE public.widget_clients DROP CONSTRAINT IF EXISTS widget_clients_one_website_check;
ALTER TABLE public.widget_clients ADD CONSTRAINT widget_clients_one_website_check
  CHECK (cardinality(allowed_domains) <= 1) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_widget_clients_tenant
  ON public.widget_clients (tenant_id) WHERE tenant_id IS NOT NULL;

-- 2. widget_conversations: who, when, ended, summary ----------------------------------------------
ALTER TABLE public.widget_conversations
  ADD COLUMN IF NOT EXISTS visitor_hash text,
  ADD COLUMN IF NOT EXISTS origin_host text,
  ADD COLUMN IF NOT EXISTS visitor_message_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_message_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS ended_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS last_quote jsonb;

UPDATE public.widget_conversations c
   SET tenant_id = w.tenant_id
  FROM public.widget_clients w
 WHERE c.client_id = w.id AND c.tenant_id IS NULL AND w.tenant_id IS NOT NULL;

UPDATE public.widget_conversations
   SET last_message_at = coalesce(updated_at, created_at)
 WHERE last_message_at IS NULL;

ALTER TABLE public.widget_conversations DROP CONSTRAINT IF EXISTS widget_conversations_status_check;
ALTER TABLE public.widget_conversations ADD CONSTRAINT widget_conversations_status_check
  CHECK (status IN ('active', 'ended')) NOT VALID;
ALTER TABLE public.widget_conversations DROP CONSTRAINT IF EXISTS widget_conversations_count_check;
ALTER TABLE public.widget_conversations ADD CONSTRAINT widget_conversations_count_check
  CHECK (visitor_message_count >= 0 AND visitor_message_count <= 30);
ALTER TABLE public.widget_conversations DROP CONSTRAINT IF EXISTS widget_conversations_summary_check;
ALTER TABLE public.widget_conversations ADD CONSTRAINT widget_conversations_summary_check
  CHECK (summary IS NULL OR char_length(summary) <= 300);

CREATE INDEX IF NOT EXISTS idx_widget_conversations_active_idle
  ON public.widget_conversations (last_message_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_widget_conversations_tenant_created
  ON public.widget_conversations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_widget_conversations_visitor
  ON public.widget_conversations (client_id, visitor_hash, created_at DESC);

-- 3. leads: quote, booking request, decision, booked for ------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS postcode text,
  ADD COLUMN IF NOT EXISTS preferred_days text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS customer_note text,
  ADD COLUMN IF NOT EXISTS job_summary text,
  ADD COLUMN IF NOT EXISTS job_type_key text,
  ADD COLUMN IF NOT EXISTS quote_kind text,
  ADD COLUMN IF NOT EXISTS quote_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS quote_min numeric(10,2),
  ADD COLUMN IF NOT EXISTS quote_max numeric(10,2),
  ADD COLUMN IF NOT EXISTS booking_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS agreed_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS decided_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS decided_by text,
  ADD COLUMN IF NOT EXISTS booked_for_date date,
  ADD COLUMN IF NOT EXISTS booked_for_time time,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS follow_up_problem text;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_client_id_fkey;
ALTER TABLE public.leads ADD CONSTRAINT leads_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES public.widget_clients(id) ON DELETE SET NULL;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_status_check
  CHECK (status IN ('new', 'contacted', 'won', 'lost')) NOT VALID;
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_quote_kind_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_quote_kind_check
  CHECK (quote_kind IS NULL OR quote_kind IN ('firm', 'guide', 'visit'));
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_quote_shape_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_quote_shape_check CHECK (
  (quote_kind IS DISTINCT FROM 'firm' OR quote_amount IS NOT NULL)
  AND (quote_kind IS DISTINCT FROM 'guide' OR (quote_min IS NOT NULL AND quote_max IS NOT NULL AND quote_min <= quote_max)));
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_amounts_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_amounts_check CHECK (
  (quote_amount IS NULL OR (quote_amount > 0 AND quote_amount <= 50000))
  AND (quote_min IS NULL OR (quote_min > 0 AND quote_min <= 50000))
  AND (quote_max IS NULL OR (quote_max > 0 AND quote_max <= 50000))
  AND (agreed_amount IS NULL OR (agreed_amount > 0 AND agreed_amount <= 50000)));
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_booking_status_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_booking_status_check
  CHECK (booking_status IN ('none', 'requested', 'accepted', 'declined'));
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_decided_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_decided_check CHECK (
  (decided_by IS NULL OR decided_by IN ('owner', 'auto'))
  AND (booking_status NOT IN ('accepted', 'declined') OR (decided_at IS NOT NULL AND decided_by IS NOT NULL))
  AND (booking_status <> 'accepted' OR agreed_amount IS NOT NULL OR quote_kind IN ('guide', 'visit')));
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_phone_e164_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_phone_e164_check
  CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+447[0-9]{9}$');
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_texts_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_texts_check CHECK (
  (customer_note IS NULL OR char_length(customer_note) <= 120)
  AND (job_summary IS NULL OR char_length(job_summary) <= 200)
  AND cardinality(preferred_days) <= 7
  AND (follow_up_problem IS NULL OR follow_up_problem IN ('out_of_texts', 'opted_out', 'failed', 'stuck')));

CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_widget_conversation
  ON public.leads (widget_conversation_id) WHERE widget_conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_tenant_status_created
  ON public.leads (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_booked
  ON public.leads (tenant_id, booked_for_date) WHERE booking_status = 'accepted';

-- 4. Copy widget_leads into leads (D15). Re-runnable: skips rows already copied. -------------------
INSERT INTO public.leads (tenant_id, source, name, phone, email, job_description, quote_given, status,
                          notes, widget_conversation_id, client_id, source_data, created_at, updated_at)
SELECT wl.tenant_id, 'widget', wl.name, wl.phone, wl.email, wl.job_description, wl.quote_given,
       CASE WHEN wl.status IN ('new', 'contacted', 'won', 'lost') THEN wl.status
            WHEN wl.status = 'converted' THEN 'won' ELSE 'new' END,
       wl.notes, wl.conversation_id, wl.client_id,
       jsonb_build_object('widget_lead_id', wl.id::text), wl.created_at, wl.updated_at
FROM public.widget_leads wl
WHERE wl.tenant_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.source_data->>'widget_lead_id' = wl.id::text)
ON CONFLICT (widget_conversation_id) WHERE widget_conversation_id IS NOT NULL DO NOTHING;

-- 5. Daily usage per widget (T5). Service role only. ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.widget_usage_daily (
  client_id uuid NOT NULL,
  day date NOT NULL,
  conversations integer NOT NULL DEFAULT 0,
  visitor_messages integer NOT NULL DEFAULT 0,
  CONSTRAINT widget_usage_daily_pkey PRIMARY KEY (client_id, day),
  CONSTRAINT widget_usage_daily_client_fkey FOREIGN KEY (client_id)
    REFERENCES public.widget_clients(id) ON DELETE CASCADE,
  CONSTRAINT widget_usage_daily_counts_check CHECK (conversations >= 0 AND visitor_messages >= 0)
);
ALTER TABLE public.widget_usage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.widget_usage_daily FROM anon, authenticated;

-- Atomically add one to a counter for today (London) if it is below p_max. True = allowed.
CREATE OR REPLACE FUNCTION public.claim_widget_usage(
  p_client_id uuid,
  p_kind text,
  p_max integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'Europe/London')::date;
  v_ok boolean := false;
BEGIN
  IF p_kind NOT IN ('conversation', 'message') OR p_max IS NULL OR p_max < 1 THEN
    RAISE EXCEPTION 'bad usage claim';
  END IF;
  INSERT INTO public.widget_usage_daily (client_id, day) VALUES (p_client_id, v_day)
  ON CONFLICT (client_id, day) DO NOTHING;
  IF p_kind = 'conversation' THEN
    UPDATE public.widget_usage_daily SET conversations = conversations + 1
     WHERE client_id = p_client_id AND day = v_day AND conversations < p_max
    RETURNING true INTO v_ok;
  ELSE
    UPDATE public.widget_usage_daily SET visitor_messages = visitor_messages + 1
     WHERE client_id = p_client_id AND day = v_day AND visitor_messages < p_max
    RETURNING true INTO v_ok;
  END IF;
  RETURN coalesce(v_ok, false);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_widget_usage(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_widget_usage(uuid, text, integer) TO service_role;

-- 6. One-tap links for booking requests (T11). Only the SHA-256 of the token is stored. -------------
CREATE TABLE IF NOT EXISTS public.lead_action_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lead_action_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT lead_action_tokens_hash_key UNIQUE (token_hash),
  CONSTRAINT lead_action_tokens_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT lead_action_tokens_lead_fkey FOREIGN KEY (lead_id)
    REFERENCES public.leads(id) ON DELETE CASCADE,
  CONSTRAINT lead_action_tokens_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_lead_action_tokens_lead ON public.lead_action_tokens (lead_id);
ALTER TABLE public.lead_action_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_action_tokens FROM anon, authenticated;

-- 7. Row security: tenant admins may READ their own widget, chats and leads. ----------------------
ALTER TABLE public.widget_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.widget_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.widget_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "widget_clients_admin_select" ON public.widget_clients;
CREATE POLICY "widget_clients_admin_select" ON public.widget_clients FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "widget_conversations_admin_select" ON public.widget_conversations;
CREATE POLICY "widget_conversations_admin_select" ON public.widget_conversations FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "leads_admin_select" ON public.leads;
CREATE POLICY "leads_admin_select" ON public.leads FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'));

REVOKE ALL ON public.widget_clients, public.widget_conversations, public.widget_leads, public.leads FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.widget_clients, public.widget_conversations, public.widget_leads, public.leads FROM authenticated;
REVOKE SELECT ON public.widget_leads FROM authenticated;
GRANT SELECT ON public.widget_clients, public.widget_conversations, public.leads TO authenticated;

COMMENT ON COLUMN public.widget_clients.allowed_domains IS
  'D2: the one website (bare hostname, e.g. daveplastering.co.uk). www. is allowed in code. Empty = widget off in public.';
COMMENT ON COLUMN public.widget_clients.owner_mobile_e164 IS
  'The tradie''s own mobile: put in the follow-up text (D6) and used for "text me too" (D8).';
COMMENT ON COLUMN public.leads.booking_status IS
  'T10: none | requested (customer pressed Book it) | accepted | declined. Only lib/lite/leads-core.ts changes it.';
COMMENT ON COLUMN public.leads.follow_up_problem IS
  'Why the follow-up text did not go: out_of_texts | opted_out | failed | stuck. Shown on the lead card.';
COMMENT ON TABLE public.widget_usage_daily IS 'T5 daily limits per widget (London day). Written only by claim_widget_usage.';
COMMENT ON TABLE public.lead_action_tokens IS 'T11 one-tap Accept/Decline/Change price links. SHA-256 only; service role only.';
