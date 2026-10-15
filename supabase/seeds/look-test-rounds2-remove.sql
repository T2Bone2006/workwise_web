-- Removes everything look-test-rounds2.sql added to "Test rounds 2".
-- It only deletes rows marked [look-test] / LT- for that one business and the
-- messages, visits and money that hang off those test customers. Your other
-- customers and data stay.

DO $$
DECLARE
  v_tenant constant uuid := 'f571681c-3054-4836-8086-11c1777fc4ea';
  v_tag    constant text := '[look-test]';
  v_customers uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant AND name = 'Test rounds 2') THEN
    RAISE EXCEPTION 'Expected the tenant "Test rounds 2". Nothing was changed.';
  END IF;

  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_customers
    FROM public.customers WHERE tenant_id = v_tenant AND notes LIKE v_tag || '%';

  -- Lite
  DELETE FROM public.leads WHERE tenant_id = v_tenant AND notes = v_tag;
  DELETE FROM public.widget_conversations WHERE tenant_id = v_tenant AND summary LIKE v_tag || '%';

  -- Texts
  DELETE FROM public.messages WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.message_threads WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);

  -- Money (allocations first: they point at payments and visits)
  DELETE FROM public.payment_allocations
   WHERE tenant_id = v_tenant
     AND payment_id IN (SELECT id FROM public.payments WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers));
  DELETE FROM public.payments WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.invoice_lines
   WHERE tenant_id = v_tenant
     AND invoice_id IN (SELECT id FROM public.invoices WHERE tenant_id = v_tenant AND footer = v_tag);
  DELETE FROM public.invoices WHERE tenant_id = v_tenant AND footer = v_tag;
  DELETE FROM public.expenses WHERE tenant_id = v_tenant AND note = v_tag;

  -- Round
  DELETE FROM public.jobs WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.service_agreements WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.customers WHERE tenant_id = v_tenant AND id = ANY (v_customers);

  RAISE NOTICE 'Look-test data removed from Test rounds 2.';
END $$;
