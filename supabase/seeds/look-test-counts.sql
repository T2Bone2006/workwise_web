-- Look-test data check (READ ONLY — it only counts, it changes nothing).
-- Phase 7b step 1. Paste into the Supabase SQL Editor, change the name in the
-- first line (Clearview Window Cleaning = Rounds + Lite; Dave's Plastering = Lite only),
-- run it, and send back the table it prints.
--
-- "Enough" for Clearview: customers 40, agreements 40, visits next 4 weeks 60,
-- visits last 8 weeks 80, payments 30, invoices 10, message threads 5,
-- expenses 15, leads 8, conversations 12. Dave: leads 8, conversations 12.
WITH t AS (SELECT id FROM public.tenants WHERE name = 'Clearview Window Cleaning' LIMIT 1)
SELECT 'customers' AS what, count(*) AS n FROM public.customers WHERE tenant_id = (SELECT id FROM t)
UNION ALL SELECT 'agreements', count(*) FROM public.service_agreements WHERE tenant_id = (SELECT id FROM t)
UNION ALL SELECT 'visits next 4 weeks', count(*) FROM public.jobs WHERE tenant_id = (SELECT id FROM t)
  AND scheduled_date BETWEEN current_date AND current_date + 28
UNION ALL SELECT 'visits last 8 weeks', count(*) FROM public.jobs WHERE tenant_id = (SELECT id FROM t)
  AND scheduled_date BETWEEN current_date - 56 AND current_date - 1
UNION ALL SELECT 'payments', count(*) FROM public.payments WHERE tenant_id = (SELECT id FROM t)
UNION ALL SELECT 'invoices', count(*) FROM public.invoices WHERE tenant_id = (SELECT id FROM t)
UNION ALL SELECT 'message threads', count(*) FROM public.message_threads WHERE tenant_id = (SELECT id FROM t)
UNION ALL SELECT 'expenses', count(*) FROM public.expenses WHERE tenant_id = (SELECT id FROM t)
UNION ALL SELECT 'leads', count(*) FROM public.leads WHERE tenant_id = (SELECT id FROM t)
UNION ALL SELECT 'conversations', count(*) FROM public.widget_conversations WHERE tenant_id = (SELECT id FROM t);
