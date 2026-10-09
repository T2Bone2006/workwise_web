-- Removes everything gocardless-demo.sql added to "Clearview Windows"
-- (only rows tagged [gc-demo]; anything else in that business stays).

DO $$
DECLARE
  v_tag constant text := '[gc-demo]';
  v_tenant uuid;
  v_customers uuid[];
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE name = 'Clearview Windows';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No business called "Clearview Windows". Nothing was changed.';
  END IF;

  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_customers
    FROM public.customers WHERE tenant_id = v_tenant AND notes LIKE v_tag || '%';

  -- Direct Debit rows made while recording the demo
  DELETE FROM public.gocardless_pay_requests WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.direct_debit_collections WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.customer_direct_debits WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.messages WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.message_threads WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.payment_allocations
   WHERE tenant_id = v_tenant
     AND payment_id IN (SELECT id FROM public.payments WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers));
  DELETE FROM public.payments WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.jobs WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.service_agreements WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.customers WHERE tenant_id = v_tenant AND id = ANY (v_customers);

  RAISE NOTICE 'GoCardless demo data removed from Clearview Windows.';
END $$;
