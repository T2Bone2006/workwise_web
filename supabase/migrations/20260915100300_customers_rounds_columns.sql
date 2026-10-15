-- Rounds columns on customers: how to reach them (Phase 3 messaging), how they
-- pay (Phase 2), and site access notes. Landed now so the Rounds customer form
-- and the spreadsheet import write them once.

ALTER TABLE public.customers
  -- E.164 (+447700900123) derived from phone by the app; messaging keys on this.
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS preferred_channel text,
  ADD COLUMN IF NOT EXISTS messaging_opt_in_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS messaging_opt_out_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamp with time zone,
  -- NULL = unknown; false after a WhatsApp delivery failure (Phase 3).
  ADD COLUMN IF NOT EXISTS whatsapp_capable boolean,
  ADD COLUMN IF NOT EXISTS payment_terms text NOT NULL DEFAULT 'on_the_day',
  -- What this customer usually puts in a bank transfer reference (Phase 4 matching).
  ADD COLUMN IF NOT EXISTS bank_reference_hint text,
  ADD COLUMN IF NOT EXISTS access_notes text;

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_preferred_channel_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_preferred_channel_check CHECK (
    preferred_channel IS NULL OR preferred_channel IN ('whatsapp', 'sms', 'email', 'none')
  );

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_payment_terms_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_payment_terms_check CHECK (
    payment_terms IN ('on_the_day', 'monthly_invoice')
  );

CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone_e164
  ON public.customers (tenant_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;
