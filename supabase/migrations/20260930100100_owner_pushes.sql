-- Phase 4 (Direct Debit), file 2 of 4. Paste after 20260930100000_customer_charges,
-- before 20260930100200_direct_debits.
--
-- owner_pushes: pushes to the trader held during quiet hours (21:00-07:00 London),
-- sent by the 07:00 cron. Several of one kind for one business are sent as one.
-- Service role only. Additive. Idempotent.

CREATE TABLE IF NOT EXISTS public.owner_pushes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  send_after timestamp with time zone NOT NULL,
  sent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT owner_pushes_pkey PRIMARY KEY (id),
  CONSTRAINT owner_pushes_tenant_id_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT owner_pushes_kind_check CHECK (kind IN (
    'card_payment', 'dd_payment', 'dd_failed', 'dd_cancelled', 'dd_active', 'dd_attention'
  )),
  CONSTRAINT owner_pushes_title_len CHECK (char_length(title) BETWEEN 1 AND 80),
  CONSTRAINT owner_pushes_body_len CHECK (char_length(body) BETWEEN 1 AND 200)
);

COMMENT ON TABLE public.owner_pushes IS
  'Phase 4: pushes to the trader held during quiet hours; sent by the 07:00 cron. Service role only.';
COMMENT ON COLUMN public.owner_pushes.data IS
  'Push payload: { type, amount?, customerId?, customerName? } — amount and name let the sender group several into one push.';

CREATE INDEX IF NOT EXISTS idx_owner_pushes_due
  ON public.owner_pushes (send_after)
  WHERE sent_at IS NULL;

-- Re-created so a later paste with more kinds replaces the list.
ALTER TABLE public.owner_pushes DROP CONSTRAINT IF EXISTS owner_pushes_kind_check;
ALTER TABLE public.owner_pushes
  ADD CONSTRAINT owner_pushes_kind_check CHECK (kind IN (
    'card_payment', 'dd_payment', 'dd_failed', 'dd_cancelled', 'dd_active', 'dd_attention'
  ));

ALTER TABLE public.owner_pushes ENABLE ROW LEVEL SECURITY;
-- No policies: service role only.
REVOKE ALL ON public.owner_pushes FROM anon, authenticated;
