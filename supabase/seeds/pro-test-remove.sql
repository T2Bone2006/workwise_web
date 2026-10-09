-- Removes everything pro-test.sql added to ONE business, then turns it back into
-- an ordinary (Rounds-less) shell: it deletes the Pro test rows only. It does not
-- delete the business or the login.
--
-- Change v_name on the first line to the same name you used in pro-test.sql.
-- Only rows made by the seed are removed (references PT-%, customers tagged
-- '[pro-test]', workers with phone 07700 9009%, the tagged Pro subscription).

DO $$
DECLARE
  v_name constant text := 'PUT-THE-TEST-BUSINESS-NAME-HERE';
  v_tag  constant text := '[pro-test]';
  v_tenant uuid;
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.tenants WHERE name = v_name;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one business named "%" but found %.', v_name, v_n;
  END IF;
  SELECT id INTO v_tenant FROM public.tenants WHERE name = v_name;
  IF lower(v_name) IN ('rs locksmiths','eden technologies') THEN
    RAISE EXCEPTION 'This file must never run on a real Pro business.';
  END IF;

  DELETE FROM public.notifications
   WHERE tenant_id = v_tenant AND job_id IN (SELECT id FROM public.jobs WHERE tenant_id = v_tenant AND reference_number LIKE 'PT-%');
  DELETE FROM public.job_attachments
   WHERE job_id IN (SELECT id FROM public.jobs WHERE tenant_id = v_tenant AND reference_number LIKE 'PT-%');
  DELETE FROM public.job_status_history
   WHERE job_id IN (SELECT id FROM public.jobs WHERE tenant_id = v_tenant AND reference_number LIKE 'PT-%');
  DELETE FROM public.jobs WHERE tenant_id = v_tenant AND reference_number LIKE 'PT-%';
  DELETE FROM public.customers WHERE tenant_id = v_tenant AND notes LIKE v_tag || '%';
  DELETE FROM public.worker_tenants
   WHERE tenant_id = v_tenant
     AND worker_id IN (SELECT id FROM public.workers WHERE primary_tenant_id = v_tenant AND phone LIKE '07700 9009%');
  DELETE FROM public.workers WHERE primary_tenant_id = v_tenant AND phone LIKE '07700 9009%';
  DELETE FROM public.subscriptions WHERE tenant_id = v_tenant AND product = 'pro' AND notes LIKE v_tag || '%';

  UPDATE public.tenants
     SET settings = COALESCE(settings, '{}'::jsonb) - 'job_report_fields' - 'look'
   WHERE id = v_tenant;

  RAISE NOTICE 'Pro test data removed from "%". Its Rounds/Lite subscription rows stay canceled; re-sign-up for a clean Rounds test.', v_name;
END $$;
