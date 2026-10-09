-- Gives your Pro Test WORKER LOGIN some jobs, so the phone app has something to show.
--
-- The 45 seeded jobs belong to the five made-up workers. The login you invited
-- (tayloreden2006+worker@gmail.com) is a separate worker with no jobs yet. This
-- moves 12 of the seeded jobs onto that worker: finished ones, ones for today and
-- the coming days, one in progress, one ready-to-send, one not completed.
--
-- SAFE BY DESIGN
--   * Only touches business "Pro Test" and jobs whose reference starts 'PT-'.
--   * It only changes who a job is assigned to. Statuses and dates don't change,
--     so nothing is emailed and no outcome is recorded.
--   * Safe to run again. To give the jobs back, run pro-test-remove.sql (it removes the
--     whole seed) or re-run pro-test.sql after it.

DO $$
DECLARE
  v_name  constant text := 'Pro Test';
  v_email constant text := 'tayloreden2006+worker@gmail.com';
  v_tenant uuid;
  v_worker uuid;
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.tenants WHERE name = v_name;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one business named "%" but found %.', v_name, v_n;
  END IF;
  SELECT id INTO v_tenant FROM public.tenants WHERE name = v_name;

  SELECT count(*) INTO v_n FROM public.workers WHERE primary_tenant_id = v_tenant AND lower(email) = lower(v_email);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one worker with email % in "%" but found %. Has the invite been accepted?', v_email, v_name, v_n;
  END IF;
  SELECT id INTO v_worker FROM public.workers WHERE primary_tenant_id = v_tenant AND lower(email) = lower(v_email);

  UPDATE public.jobs
     SET assigned_worker_id = v_worker
   WHERE tenant_id = v_tenant
     AND reference_number IN (
       'PT-0001','PT-0002','PT-0003','PT-0004',   -- completed
       'PT-0015','PT-0016','PT-0017','PT-0018',   -- assigned
       'PT-0024',                                 -- in progress
       'PT-0033',                                 -- ready to send
       'PT-0036'                                  -- not completed
     );

  RAISE NOTICE 'Gave % to the worker login.', 'PT-0001..0004, 0015..0018, 0024, 0033, 0036';
END $$;
