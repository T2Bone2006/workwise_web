-- Phase 3 (messaging), file 1 of 3. Paste before 20260929100100.
--
-- What this adds:
--   1. customers: visit_reminders (default OFF) and payment_chasers (default ON).
--   2. jobs: reply labels. customer_confirmation_status gains 'replied';
--      customer_requested_date + customer_reply_at are new. Nothing ever
--      writes 'pending' or 'confirmed' (reminders are opt-out; no YES).
--   3. message_threads + messages: every text sent or received (and every
--      automated email sent instead of a text), per business.
--      Admins of the business can read; only the server (service role) writes.
--   4. messaging_opt_outs: STOP is global across every WorkWise business
--      because all businesses share one number.
--   5. messaging_inbound_limits: spam limit (10 in 24h -> blocked 7 days) and
--      the once-per-30-days automatic reply to unknown numbers.
--   6. messaging_unrouted_inbound: texts from numbers that are nobody's
--      customer (kept for debugging, service role only).
--   7. notifications: one "payment received" claim per payment.
--   8. Three helper functions, service role only.

-- 1. customers -----------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS visit_reminders boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_chasers boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.customers.visit_reminders IS
  'Text a reminder N days before each visit (opt-out: reply NO). Off by default.';
COMMENT ON COLUMN public.customers.payment_chasers IS
  'Send automatic payment chasers at 7 and 21 days. On by default; off = "Don''t chase".';
COMMENT ON COLUMN public.customers.messaging_opt_in_at IS
  'Phase 3: when this business first texted this customer (drives the one-time "Reply STOP to opt out").';
COMMENT ON COLUMN public.customers.messaging_opt_out_at IS
  'Phase 3: mirror of messaging_opt_outs for display. The global table is the truth.';

-- 2. jobs: reply labels ------------------------------------------------------------
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS customer_requested_date date,
  ADD COLUMN IF NOT EXISTS customer_reply_at timestamp with time zone;

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_customer_confirmation_status_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_customer_confirmation_status_check CHECK (
    customer_confirmation_status IS NULL
    OR customer_confirmation_status IN ('pending', 'confirmed', 'declined', 'rescheduled', 'replied')
  );

COMMENT ON COLUMN public.jobs.customer_confirmation_status IS
  'Phase 3 reply label: declined = said no, rescheduled = asked to move (see customer_requested_date), replied = sent a message. Cleared when the trader acts. pending/confirmed are never written.';

-- 3. message_threads ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_threads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'sms',
  -- The customer's mobile in E.164 (+447...). Updated on every text. NULL for
  -- a customer with no mobile (their thread still holds the email log).
  customer_address text,
  status text NOT NULL DEFAULT 'open',
  needs_attention_reason text,
  -- The stop the last reminder / change text was about (T10).
  active_job_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  active_set_at timestamp with time zone,
  last_inbound_at timestamp with time zone,
  last_outbound_at timestamp with time zone,
  unread_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT message_threads_pkey PRIMARY KEY (id),
  CONSTRAINT message_threads_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT message_threads_customer_id_fkey FOREIGN KEY (customer_id)
    REFERENCES public.customers(id) ON DELETE CASCADE,
  CONSTRAINT message_threads_channel_check CHECK (channel IN ('sms', 'whatsapp')),
  CONSTRAINT message_threads_status_check CHECK (status IN ('open', 'needs_attention', 'closed')),
  CONSTRAINT message_threads_unread_check CHECK (unread_count >= 0),
  CONSTRAINT message_threads_customer_channel_key UNIQUE (tenant_id, customer_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_message_threads_tenant_status
  ON public.message_threads (tenant_id, status, last_inbound_at DESC);
-- Routing an incoming text on the shared number (T11).
CREATE INDEX IF NOT EXISTS idx_message_threads_address_outbound
  ON public.message_threads (customer_address, last_outbound_at DESC);

DROP TRIGGER IF EXISTS message_threads_set_updated_at ON public.message_threads;
CREATE TRIGGER message_threads_set_updated_at
  BEFORE UPDATE ON public.message_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3b. messages ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  direction text NOT NULL,
  channel text NOT NULL DEFAULT 'sms',
  kind text NOT NULL,
  body text NOT NULL,
  to_address text,
  from_address text,
  -- First job of the stop, and all of them (a stop can have two services).
  job_id uuid,
  job_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  -- FK to visit_changes is added in file 3 (the table is created there).
  visit_change_id uuid,
  -- Unique per business; makes an automated message impossible to send twice.
  dedupe_key text,
  status text NOT NULL,
  hold_until timestamp with time zone,
  segments integer,
  billed_from text,
  -- Which month's allowance was used ('2026-10'), for refunds.
  billed_month text,
  provider text NOT NULL DEFAULT 'puresms',
  provider_message_id text,
  provider_status text,
  error text,
  -- Incoming texts only.
  classification text,
  classification_confidence numeric(4,3),
  requested_date date,
  handled_at timestamp with time zone,
  handled_action text,
  -- Set when a failed text was replaced by an email (D4).
  email_fallback_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  sent_at timestamp with time zone,
  delivered_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT messages_thread_id_fkey FOREIGN KEY (thread_id)
    REFERENCES public.message_threads(id) ON DELETE CASCADE,
  CONSTRAINT messages_customer_id_fkey FOREIGN KEY (customer_id)
    REFERENCES public.customers(id) ON DELETE CASCADE,
  CONSTRAINT messages_job_id_fkey FOREIGN KEY (job_id)
    REFERENCES public.jobs(id) ON DELETE SET NULL,
  CONSTRAINT messages_direction_check CHECK (direction IN ('inbound', 'outbound')),
  -- 'email' rows record automated emails sent instead of a text (one row per event).
  CONSTRAINT messages_channel_check CHECK (channel IN ('sms', 'whatsapp', 'email')),
  CONSTRAINT messages_kind_check CHECK (kind IN (
    'reminder', 'visit_done', 'chaser', 'payment_received', 'visit_change', 'reply_ack', 'inbound'
  )),
  CONSTRAINT messages_status_check CHECK (status IN (
    'held', 'queued', 'sent', 'delivered', 'failed', 'skipped', 'received'
  )),
  CONSTRAINT messages_billed_from_check CHECK (billed_from IS NULL OR billed_from IN ('allowance', 'pack')),
  CONSTRAINT messages_segments_check CHECK (segments IS NULL OR segments BETWEEN 1 AND 10),
  CONSTRAINT messages_classification_check CHECK (classification IS NULL OR classification IN (
    'said_no', 'asked_move', 'question', 'opt_out', 'opt_in', 'other'
  )),
  CONSTRAINT messages_handled_action_check CHECK (handled_action IS NULL OR handled_action IN (
    'skipped', 'kept', 'moved', 'dismissed'
  )),
  CONSTRAINT messages_inbound_shape_check CHECK (
    direction = 'outbound' OR (kind = 'inbound' AND status = 'received')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_tenant_dedupe
  ON public.messages (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_provider_message
  ON public.messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_thread_created
  ON public.messages (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_held
  ON public.messages (hold_until)
  WHERE status = 'held';
CREATE INDEX IF NOT EXISTS idx_messages_tenant_kind_created
  ON public.messages (tenant_id, kind, created_at DESC);

DROP TRIGGER IF EXISTS messages_set_updated_at ON public.messages;
CREATE TRIGGER messages_set_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: admins of the business read; nobody but the service role writes.
ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_threads_admin_select" ON public.message_threads;
CREATE POLICY "message_threads_admin_select"
ON public.message_threads FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "messages_admin_select" ON public.messages;
CREATE POLICY "messages_admin_select"
ON public.messages FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
);

REVOKE ALL ON public.message_threads FROM anon;
REVOKE ALL ON public.messages FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.message_threads FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.messages FROM authenticated;
GRANT SELECT ON public.message_threads TO authenticated;
GRANT SELECT ON public.messages TO authenticated;

-- 4. messaging_opt_outs (global) ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messaging_opt_outs (
  phone_e164 text NOT NULL,
  opted_out_at timestamp with time zone NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'keyword',
  last_keyword text,
  CONSTRAINT messaging_opt_outs_pkey PRIMARY KEY (phone_e164),
  CONSTRAINT messaging_opt_outs_source_check CHECK (source IN ('keyword', 'provider', 'manual'))
);
ALTER TABLE public.messaging_opt_outs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.messaging_opt_outs FROM anon, authenticated;

-- 5. messaging_inbound_limits (global) ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.messaging_inbound_limits (
  phone_e164 text NOT NULL,
  window_started_at timestamp with time zone NOT NULL DEFAULT now(),
  count_in_window integer NOT NULL DEFAULT 0,
  blocked_until timestamp with time zone,
  last_autoreply_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT messaging_inbound_limits_pkey PRIMARY KEY (phone_e164),
  CONSTRAINT messaging_inbound_limits_count_check CHECK (count_in_window >= 0)
);
ALTER TABLE public.messaging_inbound_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.messaging_inbound_limits FROM anon, authenticated;

-- 6. messaging_unrouted_inbound (global) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.messaging_unrouted_inbound (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_address text NOT NULL,
  body text NOT NULL,
  provider text NOT NULL DEFAULT 'puresms',
  provider_message_id text,
  autoreplied boolean NOT NULL DEFAULT false,
  received_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT messaging_unrouted_inbound_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_messaging_unrouted_provider_message
  ON public.messaging_unrouted_inbound (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
ALTER TABLE public.messaging_unrouted_inbound ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.messaging_unrouted_inbound FROM anon, authenticated;

-- 7. notifications: one "payment received" claim per payment ---------------------
-- Phase 2 checked-then-inserted; this makes the claim atomic. If this line
-- fails with 23505, step 6 has a query to find the duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_payment_received
  ON public.notifications (recipient_id, type)
  WHERE type = 'payment_received' AND recipient_id IS NOT NULL;

-- 8. Functions (service role only) --------------------------------------------------

-- Counts one incoming text from p_phone. Blocks the number for 7 days once it
-- sends more than p_limit texts inside a rolling-from-first 24-hour window.
CREATE OR REPLACE FUNCTION public.messaging_count_inbound(p_phone text, p_limit integer DEFAULT 10)
RETURNS TABLE (is_blocked boolean, inbound_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamp with time zone := now();
  v_row public.messaging_inbound_limits%ROWTYPE;
BEGIN
  INSERT INTO public.messaging_inbound_limits (phone_e164, window_started_at, count_in_window)
  VALUES (p_phone, v_now, 0)
  ON CONFLICT (phone_e164) DO NOTHING;

  SELECT * INTO v_row
    FROM public.messaging_inbound_limits
   WHERE phone_e164 = p_phone
   FOR UPDATE;

  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    RETURN QUERY SELECT true, v_row.count_in_window;
    RETURN;
  END IF;

  IF v_row.window_started_at < v_now - interval '24 hours' THEN
    v_row.window_started_at := v_now;
    v_row.count_in_window := 0;
  END IF;

  v_row.count_in_window := v_row.count_in_window + 1;
  IF v_row.count_in_window > p_limit THEN
    v_row.blocked_until := v_now + interval '7 days';
  END IF;

  UPDATE public.messaging_inbound_limits
     SET window_started_at = v_row.window_started_at,
         count_in_window = v_row.count_in_window,
         blocked_until = v_row.blocked_until,
         updated_at = v_now
   WHERE phone_e164 = p_phone;

  RETURN QUERY SELECT (v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now),
                      v_row.count_in_window;
END;
$$;

-- True at most once per number per 30 days: "may we send the unknown-number reply?"
CREATE OR REPLACE FUNCTION public.messaging_claim_autoreply(p_phone text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean := false;
BEGIN
  INSERT INTO public.messaging_inbound_limits (phone_e164)
  VALUES (p_phone)
  ON CONFLICT (phone_e164) DO NOTHING;

  UPDATE public.messaging_inbound_limits
     SET last_autoreply_at = now(), updated_at = now()
   WHERE phone_e164 = p_phone
     AND (last_autoreply_at IS NULL OR last_autoreply_at < now() - interval '30 days')
  RETURNING true INTO v_claimed;

  RETURN coalesce(v_claimed, false);
END;
$$;

-- An incoming text arrived on a thread: bump counters, optionally flag it.
CREATE OR REPLACE FUNCTION public.messaging_note_inbound(
  p_thread_id uuid,
  p_needs_attention boolean,
  p_reason text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.message_threads
     SET last_inbound_at = now(),
         unread_count = unread_count + 1,
         status = CASE WHEN p_needs_attention THEN 'needs_attention' ELSE status END,
         needs_attention_reason = CASE WHEN p_needs_attention THEN p_reason ELSE needs_attention_reason END
   WHERE id = p_thread_id;
$$;

REVOKE ALL ON FUNCTION public.messaging_count_inbound(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messaging_claim_autoreply(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messaging_note_inbound(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messaging_count_inbound(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.messaging_claim_autoreply(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.messaging_note_inbound(uuid, boolean, text) TO service_role;
