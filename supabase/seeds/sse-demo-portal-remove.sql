-- Removes everything sse-demo-portal.sql added for the Eden Technologies customer linked to
-- tayloreden2006@gmail.com: the jobs whose reference starts with 'SSE-DEMO-', plus their
-- photos and status history. Touches nothing else. Safe to run more than once.

DO $$
DECLARE
  v_email constant text := 'tayloreden2006@gmail.com';
  v_n int;
  v_customer uuid;
  v_ids uuid[];
BEGIN
  SELECT count(DISTINCT c.id) INTO v_n
    FROM public.customers c
    JOIN public.tenants t ON t.id = c.tenant_id
    LEFT JOIN public.customer_portal_users cpu ON cpu.customer_id = c.id
    LEFT JOIN auth.users u ON u.id = cpu.user_id
   WHERE regexp_replace(lower(t.name), '\s', '', 'g') = 'edentechnologies'
     AND (lower(u.email) = lower(v_email) OR lower(c.email) = lower(v_email));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Eden Technologies customer linked to % but found %.', v_email, v_n;
  END IF;

  SELECT DISTINCT c.id INTO v_customer
    FROM public.customers c
    JOIN public.tenants t ON t.id = c.tenant_id
    LEFT JOIN public.customer_portal_users cpu ON cpu.customer_id = c.id
    LEFT JOIN auth.users u ON u.id = cpu.user_id
   WHERE regexp_replace(lower(t.name), '\s', '', 'g') = 'edentechnologies'
     AND (lower(u.email) = lower(v_email) OR lower(c.email) = lower(v_email));

  SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM public.jobs
   WHERE customer_id = v_customer AND reference_number LIKE 'SSE-DEMO-%';

  DELETE FROM public.job_attachments    WHERE job_id = ANY (v_ids);
  DELETE FROM public.job_status_history WHERE job_id = ANY (v_ids);
  DELETE FROM public.jobs               WHERE id = ANY (v_ids);

  RAISE NOTICE 'Removed % SSE demo jobs.', coalesce(array_length(v_ids, 1), 0);
END $$;
