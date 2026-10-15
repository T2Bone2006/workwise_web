-- One-off patch for a business that already ran the FIRST version of pro-test.sql.
-- The seeded "not completed" jobs were missing the note the real trigger writes
-- (which question blocked completion), so the job page couldn't show their reason.
-- Change v_name to the same name; run once. Safe to re-run.

DO $$
DECLARE
  v_name constant text := 'PUT-THE-TEST-BUSINESS-NAME-HERE';
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

  UPDATE public.job_status_history h
     SET metadata = jsonb_build_object(
           'blocked_by',
           CASE WHEN j.industry_data ->> 'walk_away' = 'true' THEN 'walk_away' ELSE 'job_completed' END)
    FROM public.jobs j
   WHERE h.job_id = j.id
     AND j.tenant_id = v_tenant
     AND j.reference_number LIKE 'PT-%'
     AND h.to_status = 'incomplete'
     AND (h.metadata IS NULL OR h.metadata = '{}'::jsonb);
END $$;
