-- Phase 6 migration 3: texts about a lead (D6 follow-up, D7 accept/decline, D8 owner alert, D18 replies).
-- T12 own table; T13 claim-before-send, never retried after 'sending'; T14 billing like messages.

CREATE TABLE IF NOT EXISTS public.lite_texts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  kind text NOT NULL,
  direction text NOT NULL DEFAULT 'outbound',
  to_address text,
  from_address text,
  body text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  status text NOT NULL,
  skip_reason text,
  send_after timestamp with time zone,
  claimed_at timestamp with time zone,
  sent_at timestamp with time zone,
  segments integer,
  billed_from text,
  billed_month text,
  drafted_by text,
  provider text NOT NULL DEFAULT 'puresms',
  provider_message_id text,
  error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT lite_texts_pkey PRIMARY KEY (id),
  CONSTRAINT lite_texts_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT lite_texts_lead_fkey FOREIGN KEY (lead_id)
    REFERENCES public.leads(id) ON DELETE CASCADE,
  CONSTRAINT lite_texts_kind_check CHECK (kind IN (
    'follow_up', 'booking_accepted', 'booking_declined', 'owner_alert', 'reply_in')),
  CONSTRAINT lite_texts_direction_check CHECK (direction IN ('outbound', 'inbound')),
  CONSTRAINT lite_texts_status_check CHECK (status IN (
    'scheduled', 'sending', 'sent', 'emailed', 'failed', 'skipped', 'received')),
  CONSTRAINT lite_texts_skip_reason_check CHECK (skip_reason IS NULL OR skip_reason IN (
    'no_texts_left', 'opted_out', 'follow_ups_off', 'no_mobile', 'lead_closed')),
  CONSTRAINT lite_texts_shape_check CHECK (
    (direction = 'inbound' AND kind = 'reply_in' AND status = 'received' AND body IS NOT NULL)
    OR (direction = 'outbound' AND kind <> 'reply_in')),
  CONSTRAINT lite_texts_sent_has_body_check CHECK (
    status NOT IN ('sent', 'emailed', 'received') OR body IS NOT NULL),
  CONSTRAINT lite_texts_scheduled_check CHECK (
    status <> 'scheduled' OR (send_after IS NOT NULL AND to_address IS NOT NULL)),
  CONSTRAINT lite_texts_sending_check CHECK (status <> 'sending' OR claimed_at IS NOT NULL),
  CONSTRAINT lite_texts_skipped_check CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
  CONSTRAINT lite_texts_billed_check CHECK (billed_from IS NULL OR billed_from IN ('allowance', 'pack')),
  CONSTRAINT lite_texts_segments_check CHECK (segments IS NULL OR segments BETWEEN 1 AND 3),
  CONSTRAINT lite_texts_body_check CHECK (body IS NULL OR char_length(body) <= 1600),
  CONSTRAINT lite_texts_drafted_by_check CHECK (drafted_by IS NULL OR drafted_by IN ('ai', 'template'))
);

-- A text can only be scheduled once per lead and purpose (e.g. 'follow_up', 'owner_alert:new', 'booking_accepted').
CREATE UNIQUE INDEX IF NOT EXISTS uq_lite_texts_tenant_dedupe
  ON public.lite_texts (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lite_texts_provider_message
  ON public.lite_texts (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lite_texts_due
  ON public.lite_texts (send_after) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_lite_texts_sending
  ON public.lite_texts (claimed_at) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS idx_lite_texts_outbound_to
  ON public.lite_texts (to_address, created_at DESC) WHERE direction = 'outbound';
CREATE INDEX IF NOT EXISTS idx_lite_texts_lead
  ON public.lite_texts (lead_id, created_at);

DROP TRIGGER IF EXISTS set_lite_texts_updated_at ON public.lite_texts;
CREATE TRIGGER set_lite_texts_updated_at
  BEFORE UPDATE ON public.lite_texts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.lite_texts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lite_texts_admin_select" ON public.lite_texts;
CREATE POLICY "lite_texts_admin_select" ON public.lite_texts FOR SELECT TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin'));

REVOKE ALL ON public.lite_texts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.lite_texts FROM authenticated;
GRANT SELECT ON public.lite_texts TO authenticated;

COMMENT ON TABLE public.lite_texts IS
  'Phase 6 texts about a lead. Written only by lib/lite/texts.ts. scheduled -> sending (claimed) -> sent | emailed | failed | skipped. Never re-sent after sending.';
COMMENT ON COLUMN public.lite_texts.context IS
  'What the drafter may use: {first_name, job_summary, allowed_amounts[], preferred_days[], sign_off, owner_mobile}. No message bodies from the chat.';
COMMENT ON COLUMN public.lite_texts.body IS
  'Written when the text is drafted at send time (T15), or the inbound reply text.';
