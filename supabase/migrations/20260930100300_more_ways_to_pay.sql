-- Phase 4, file 4 of 4. Paste after 20260930100200_direct_debits.
--
-- payments.method gains 'pay_by_bank' (Pay by Bank through GoCardless, step 19a).
-- No PayPal (owner, 2026-09-30). Additive. Idempotent.

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_method_check CHECK (
    method IN ('cash', 'cheque', 'bank_transfer', 'card', 'direct_debit', 'pay_by_bank', 'other')
  );
