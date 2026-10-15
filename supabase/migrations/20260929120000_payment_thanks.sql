-- Payment thank-yous: per-customer switch (owner, 2026-09-29).
--
-- "Thanks for your £X payment" goes after a card payment, Mark as paid and
-- (Phase 4) a bank match. The business-wide switch lives in
-- tenants.settings.messaging.payment_thanks_enabled (JSON, no column).
-- This column lets a trader turn it off for one customer. Default ON, so
-- nothing changes for anyone until they untick it.
--
-- Additive only. Idempotent. Pro customers ignore it.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS payment_thanks boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.customers.payment_thanks IS
  'Rounds: send the "thanks for your payment" message to this customer. Default true. Business-wide switch: settings.messaging.payment_thanks_enabled.';
