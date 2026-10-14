-- Removes everything team-test.sql added, and everything the Phase 9 walkthrough created, from ONE test business.
-- The business, its owner login and its Stripe subscription stay (cancel those separately).
-- Put the same slug at the top as in team-test.sql.

DO $$
DECLARE
  v_slug constant text := 'team-test-cleaning';
  v_tag  constant text := '[team-test]';
  v_tenant uuid;
  v_customers uuid[];
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = v_slug;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No business with the slug "%". Nothing was changed.', v_slug;
  END IF;

  -- The test customers, plus any customer a lead added during the walkthrough.
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_customers
    FROM public.customers
   WHERE tenant_id = v_tenant AND (notes LIKE v_tag || '%' OR added_by_worker_id IS NOT NULL);

  -- Texts and visit changes (messages point at visit_changes, so messages first)
  DELETE FROM public.messages WHERE tenant_id = v_tenant;
  DELETE FROM public.message_threads WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.visit_changes WHERE tenant_id = v_tenant;

  -- Money
  DELETE FROM public.payment_allocations
   WHERE tenant_id = v_tenant
     AND payment_id IN (SELECT id FROM public.payments WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers));
  DELETE FROM public.payments WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.team_payments WHERE tenant_id = v_tenant;
  DELETE FROM public.expenses WHERE tenant_id = v_tenant AND category = 'wages';

  -- Team records
  DELETE FROM public.work_days WHERE tenant_id = v_tenant;
  DELETE FROM public.team_days_off WHERE tenant_id = v_tenant;

  -- Round
  DELETE FROM public.jobs WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.service_agreements WHERE tenant_id = v_tenant AND customer_id = ANY (v_customers);
  DELETE FROM public.customers WHERE tenant_id = v_tenant AND id = ANY (v_customers);
  DELETE FROM public.rounds WHERE tenant_id = v_tenant AND name IN ('Monday north', 'Tuesday south');

  RAISE NOTICE 'Team-test data removed from "%". The team people (Dave, Lee, Sam) stay: remove them from the Team page.', v_slug;
END $$;
