-- Phase 9 walkthrough: two small things you paste (Supabase SQL Editor). Paste PART 1, run it, then PART 2, run it, and send me the PART 2 result table.
-- Test business only (team-test-cleaning). Nothing here changes the app's rules.

-- ===================================================================================================
-- PART 1 (row 11): make Dave's £20 cash look 4 days old, so the "old cash" nudge has something to find.
-- ===================================================================================================
UPDATE public.payments
   SET received_at = now() - interval '4 days'
 WHERE id = 'b29038c5-5038-4f50-91c2-b4892eba5373'
   AND tenant_id = 'ce37842c-4ea9-465f-a3d4-33841be782a3';

-- ===================================================================================================
-- PART 2 (row 16): what the DATABASE lets Dave read, even if the app were bypassed.
-- Runs as Dave's login for this one statement block, then throws everything away (ROLLBACK).
-- Expect every row to be 0 EXCEPT customers and jobs, which may only be Dave's own (not all 25 / all visits).
-- ===================================================================================================
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"sub":"92b34abc-6e5b-4184-bc86-888b6d481f16","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT 'payments' AS what, count(*) AS rows_dave_can_read FROM public.payments
UNION ALL SELECT 'expenses', count(*) FROM public.expenses
UNION ALL SELECT 'invoices', count(*) FROM public.invoices
UNION ALL SELECT 'service_agreements', count(*) FROM public.service_agreements
UNION ALL SELECT 'team_people', count(*) FROM public.team_people
UNION ALL SELECT 'team_payments', count(*) FROM public.team_payments
UNION ALL SELECT 'work_days', count(*) FROM public.work_days
UNION ALL SELECT 'messages', count(*) FROM public.messages
UNION ALL SELECT 'customers (should be Dave''s only)', count(*) FROM public.customers
UNION ALL SELECT 'jobs (should be Dave''s only)', count(*) FROM public.jobs
ORDER BY 1;
-- For comparison: the business has 25 customers and 6 + 2 + 9 + 2 + 9 + 2 + 2 + 2 + 2 = 36 visits plus Mrs Patel's.
-- Dave should see well under that (customers on his visits only, never all 25).
ROLLBACK;
