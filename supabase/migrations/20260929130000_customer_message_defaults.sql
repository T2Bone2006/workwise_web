-- Per-customer reminders, payment chasing and payment thank-yous become a
-- choice: NULL = business default, true = yes, false = no (owner, 2026-09-29).
--
-- The Settings switches (reminders_enabled, chasers_enabled,
-- payment_thanks_enabled) are that default. An explicit yes still sends when
-- the default is off. An explicit no never sends when the default is on.
--
-- Rows still sitting on the old column default become NULL so they follow
-- Settings. A reminder that was turned on stays yes. A customer set to
-- don't-chase or no thank-you stays no.
--
-- Additive. Idempotent. Pro ignores these columns.

ALTER TABLE public.customers
  ALTER COLUMN visit_reminders DROP NOT NULL,
  ALTER COLUMN visit_reminders SET DEFAULT NULL,
  ALTER COLUMN payment_chasers DROP NOT NULL,
  ALTER COLUMN payment_chasers SET DEFAULT NULL,
  ALTER COLUMN payment_thanks DROP NOT NULL,
  ALTER COLUMN payment_thanks SET DEFAULT NULL;

UPDATE public.customers
SET visit_reminders = NULL
WHERE visit_reminders = false;

UPDATE public.customers
SET payment_chasers = NULL
WHERE payment_chasers = true;

UPDATE public.customers
SET payment_thanks = NULL
WHERE payment_thanks = true;

COMMENT ON COLUMN public.customers.visit_reminders IS
  'Rounds: NULL = follow settings.messaging.reminders_enabled, true = always remind, false = never.';
COMMENT ON COLUMN public.customers.payment_chasers IS
  'Rounds: NULL = follow settings.messaging.chasers_enabled, true = always chase, false = never.';
COMMENT ON COLUMN public.customers.payment_thanks IS
  'Rounds: NULL = follow settings.messaging.payment_thanks_enabled, true = always thank, false = never.';
