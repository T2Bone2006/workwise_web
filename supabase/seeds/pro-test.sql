-- Pro test business (Pro refresh, 2026-10-07).
--
-- Turns ONE freshly signed-up test business into a Pro business filled with
-- realistic locksmith-style data, so the Pro dashboard, the Pro phone app and
-- the Pro assistant can be judged with real numbers:
--   * a manual Pro subscription (its Rounds/Lite subscription rows are marked
--     canceled so the sidebar shows Pro only)
--   * the new dashboard look switched on (settings.look = 'new')
--   * a report form like RS Locksmiths' (lock changed? / walked away? / why?)
--   * 5 workers (4 active, 1 invite pending), 6 customers, 45 jobs in every
--     status: completed, assigned, in progress, pending, pending send,
--     incomplete, declined, cancelled, paused
--
-- HOW TO USE
--   1. Sign up a new test account on the sign-up page (Rounds is fine; use an
--      extra email such as yourgmail+protest@gmail.com). Note the business name
--      you gave it.
--   2. Change v_name on the first line below to EXACTLY that name.
--   3. Paste this whole file into the Supabase SQL Editor and run it ONCE.
--
-- SAFE BY DESIGN
--   * It only touches the one business named in v_name. It stops with an error
--     if that name matches zero or several businesses, if it is RS Locksmiths
--     or Eden Technologies, or if the business already has jobs, customers,
--     seeded workers or a Pro subscription (the worker row that sign-up makes
--     for you is fine and is left alone).
--   * Rows are inserted straight into the tables. Nothing calls the app, so no
--     emails or texts are sent.
--   * Every row is findable: customers.notes start with '[pro-test]', job
--     references start with 'PT-', worker phones start with '07700 9009'.
--     To undo it all, paste pro-test-remove.sql (same v_name).
--   * Workers have no phone login yet. To try the phone app, invite a real
--     address (yourgmail+worker@gmail.com) from Workers > Invite worker.
--
-- Dates are built from today, so the week has content. Remove and re-run in a
-- few weeks to freshen them.

DO $$
DECLARE
  v_name constant text := 'PUT-THE-TEST-BUSINESS-NAME-HERE';
  v_tag  constant text := '[pro-test]';

  v_tenant    uuid;
  v_n         int;
  v_workers   uuid[] := '{}';
  v_customers uuid[] := '{}';
  v_id        uuid;
  v_w         uuid;
  v_c         uuid;

  v_worker_names text[] := ARRAY['Dave Mercer','Priya Shah','Tom Kowalski','Sean Fitzgerald','Alicia Grant'];
  v_worker_skills jsonb[] := ARRAY[
    '["lockout","upvc","safes"]'::jsonb, '["lockout","upvc"]'::jsonb,
    '["lockout","garage","cylinders"]'::jsonb, '["upvc","cylinders"]'::jsonb, '["lockout"]'::jsonb
  ];
  v_customer_names text[] := ARRAY[
    'Northgate Lettings','Calder Housing Association','Pennine Property Management',
    'Hartley & Co Estate Agents','Brightside Homes','Oakwood Facilities'
  ];
  v_streets text[] := ARRAY[
    'Lapwing Lane','Brook Road','Mauldeth Road','Albany Road','Lindow Grove',
    'Fog Lane','Kingsway','Parsonage Road','Egerton Road','Cavendish Road',
    'Wilbraham Road','Barlow Moor Road'
  ];
  v_pcs text[] := ARRAY[
    'M20 2PQ','M20 3GH','M20 4LJ','M20 6AD','M20 1EL','M20 5BT',
    'M14 6NS','M14 7QA','M14 5TY','M20 2WX','M21 9LN','M16 8FP'
  ];
  v_jobs text[] := ARRAY[
    'Lock change after tenant move-out',
    'Broken key extraction from front door',
    'Emergency lockout',
    'Fit new multipoint lock to UPVC door',
    'Repair loose door handle and cylinder',
    'Fit security chain and viewer',
    'Replace cylinder with anti-snap lock',
    'Garage door lock repair'
  ];
  v_lock_types text[] := ARRAY['Euro cylinder','Mortice 5-lever','Multipoint (UPVC)','Night latch','Padlock hasp'];
  v_access text[] := ARRAY['Key safe 4471','Tenant in, call on arrival','Agent will meet on site','Concierge has keys','Call 20 mins before'];
  v_decline text[] := ARRAY[
    'Too far from my next job',
    'Van off the road today',
    'Not trained on this lock type'
  ];
  v_walk text[] := ARRAY[
    'Tenant refused entry once we arrived',
    'Door frame rotten, cannot fit a new lock safely',
    'Part needed is not on the van, customer to reorder'
  ];

  i int;
  v_status text;
  v_date date;
  v_time time;
  v_start timestamptz;
  v_amount numeric;
  v_ref text;
  v_lat numeric;
  v_lng numeric;
  v_industry jsonb;
  v_priority text;
BEGIN
  -- ---- guards --------------------------------------------------------------
  SELECT count(*) INTO v_n FROM public.tenants WHERE name = v_name;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one business named "%" but found %. Fix v_name on the first line.', v_name, v_n;
  END IF;
  SELECT id INTO v_tenant FROM public.tenants WHERE name = v_name;

  IF lower(v_name) IN ('rs locksmiths','eden technologies') THEN
    RAISE EXCEPTION 'This file must never run on a real Pro business.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.jobs WHERE tenant_id = v_tenant)
     OR EXISTS (SELECT 1 FROM public.customers WHERE tenant_id = v_tenant)
     OR EXISTS (SELECT 1 FROM public.workers WHERE primary_tenant_id = v_tenant AND phone LIKE '07700 9009%')
     OR EXISTS (SELECT 1 FROM public.subscriptions WHERE tenant_id = v_tenant AND product IN ('starter','growth','pro')) THEN
    -- (A worker row made by sign-up itself is fine and is left alone.)
    RAISE EXCEPTION '"%" already has jobs, customers, seed workers or a Pro subscription. Run pro-test-remove.sql first, or use a fresh sign-up.', v_name;
  END IF;

  -- ---- plan, look, report form --------------------------------------------
  UPDATE public.subscriptions
     SET status = 'canceled', updated_at = now()
   WHERE tenant_id = v_tenant AND product IN ('rounds','lite') AND status <> 'canceled';

  INSERT INTO public.subscriptions (tenant_id, product, status, source, seats, notes)
  VALUES (v_tenant, 'pro', 'manual', 'manual', 5, v_tag || ' Pro test business');

  UPDATE public.tenants
     SET industry = COALESCE(industry, 'locksmith'),
         settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
           'look', 'new',
           'job_report_fields', jsonb_build_array(
             jsonb_build_object('id','lock_changed','label','Was the lock changed?','type','yes_no'),
             jsonb_build_object('id','lock_fitted','label','Lock fitted','type','select',
               'options', jsonb_build_array('Euro cylinder','Mortice 5-lever','Multipoint (UPVC)','Night latch','Other')),
             jsonb_build_object('id','walk_away','label','Did you walk away from the job?','type','yes_no',
               'blocks_completion', true),
             jsonb_build_object('id','walk_away_detail','label','Why did you walk away?','type','text',
               'multiline', true, 'show_when', jsonb_build_object('field','walk_away','value', true))
           ))
   WHERE id = v_tenant;

  -- ---- workers -------------------------------------------------------------
  FOR i IN 1..5 LOOP
    INSERT INTO public.workers (full_name, phone, email, primary_tenant_id, home_postcode, skills, invite_status)
    VALUES (
      v_worker_names[i],
      '07700 9009' || lpad(i::text, 2, '0'),
      NULL,
      v_tenant,
      v_pcs[i],
      v_worker_skills[i],
      CASE WHEN i = 5 THEN 'pending' ELSE 'accepted' END
    )
    RETURNING id INTO v_id;
    v_workers := v_workers || v_id;

    INSERT INTO public.worker_tenants (worker_id, tenant_id, status, is_primary, hourly_rate, commission_rate)
    VALUES (v_id, v_tenant, 'active', true, 18 + i, 10);
  END LOOP;

  -- ---- customers -----------------------------------------------------------
  FOR i IN 1..6 LOOP
    INSERT INTO public.customers (tenant_id, name, contact_person, email, phone, billing_address, notes)
    VALUES (
      v_tenant,
      v_customer_names[i],
      (ARRAY['Helen Burke','Marcus Bell','Ruth Ashworth','Ian Cartwright','Zoe Mahmood','Neil Parkin'])[i],
      'jobs' || i || '@example.test',
      '0161 496 0' || lpad((100 + i)::text, 3, '0'),
      (10 + i) || ' ' || v_streets[i] || ', Manchester ' || v_pcs[i],
      v_tag || ' demo customer'
    )
    RETURNING id INTO v_id;
    v_customers := v_customers || v_id;
  END LOOP;

  -- ---- jobs ----------------------------------------------------------------
  FOR i IN 1..45 LOOP
    v_status := CASE
      WHEN i <= 14 THEN 'completed'
      WHEN i <= 23 THEN 'assigned'
      WHEN i <= 26 THEN 'in_progress'
      WHEN i <= 32 THEN 'pending'
      WHEN i <= 35 THEN 'pending_send'
      WHEN i <= 39 THEN 'incomplete'
      WHEN i <= 42 THEN 'declined'
      WHEN i <= 44 THEN 'cancelled'
      ELSE 'paused' END;

    v_date := CASE v_status
      WHEN 'completed'    THEN current_date - (1 + (i * 3) % 13)
      WHEN 'assigned'     THEN current_date + (i % 6)
      WHEN 'in_progress'  THEN current_date
      WHEN 'pending'      THEN current_date + 1 + (i % 9)
      WHEN 'pending_send' THEN current_date + 2 + (i % 3)
      WHEN 'incomplete'   THEN current_date - (1 + (i % 6))
      WHEN 'declined'     THEN current_date + (i % 4)
      WHEN 'cancelled'   THEN current_date - 2 - (i % 3)
      ELSE current_date END;

    v_time := make_time(8 + (i % 9), (i % 2) * 30, 0);
    v_start := (v_date + v_time)::timestamp AT TIME ZONE 'Europe/London';
    v_amount := 45 + (i % 7) * 15;
    v_c := v_customers[1 + (i % 6)];
    v_w := CASE WHEN v_status IN ('assigned','in_progress','completed','incomplete','pending_send','paused')
                THEN v_workers[1 + (i % 4)] ELSE NULL END;
    v_priority := CASE WHEN i % 11 = 0 THEN 'emergency' WHEN i % 5 = 0 THEN 'high' ELSE 'normal' END;
    v_ref := 'PT-' || lpad(i::text, 4, '0');
    v_lat := 53.40 + ((i * 7) % 20) / 200.0;
    v_lng := -2.25 - ((i * 11) % 20) / 200.0;

    v_industry := '{}'::jsonb;
    IF v_status = 'completed' THEN
      v_industry := jsonb_build_object(
        'job_completed', true, 'lock_changed', (i % 4 <> 0), 'walk_away', false,
        'lock_fitted', v_lock_types[1 + (i % 5)],
        'job_notes', 'All done, keys handed to ' || CASE WHEN i % 2 = 0 THEN 'the tenant.' ELSE 'the agent.' END);
    ELSIF v_status = 'incomplete' THEN
      IF i % 2 = 0 THEN
        v_industry := jsonb_build_object('job_completed', true, 'lock_changed', false, 'walk_away', true,
          'walk_away_detail', v_walk[1 + (i % 3)]);
      ELSE
        v_industry := jsonb_build_object('job_completed', false,
          'incomplete_reason', v_walk[1 + (i % 3)], 'job_notes', 'Customer informed on site.');
      END IF;
    END IF;

    INSERT INTO public.jobs (
      tenant_id, reference_number, customer_id, assigned_worker_id, address, postcode, lat, lng,
      job_description, status, priority, scheduled_date, scheduled_time, estimated_duration_minutes,
      started_at, arrived_at, completed_at, quoted_amount, final_amount, completion_notes,
      industry_data, decline_reason, source_fields
    ) VALUES (
      v_tenant, v_ref, v_c, v_w,
      (3 + i * 2) || ' ' || v_streets[1 + (i % 12)] || ', Manchester', v_pcs[1 + (i % 12)], v_lat, v_lng,
      v_jobs[1 + (i % 8)],
      v_status::public.job_status, v_priority::public.job_priority, v_date, v_time, 30 + (i % 4) * 30,
      CASE WHEN v_status IN ('in_progress','completed','incomplete') THEN v_start END,
      CASE WHEN v_status IN ('in_progress','completed','incomplete') THEN v_start - interval '8 minutes' END,
      CASE WHEN v_status = 'completed' THEN v_start + interval '50 minutes' END,
      v_amount,
      CASE WHEN v_status = 'completed' THEN v_amount END,
      CASE WHEN v_status = 'completed' THEN v_industry ->> 'job_notes' END,
      v_industry,
      CASE WHEN v_status = 'declined' THEN v_decline[1 + (i % 3)] END,
      jsonb_build_object(
        'Property Ref', 'PR-' || (4800 + i),
        'Lock Type', v_lock_types[1 + ((i + 2) % 5)],
        'Tenant Contact', '07700 900' || lpad(i::text, 3, '0'),
        'Access', v_access[1 + (i % 5)],
        'Job Type', v_jobs[1 + (i % 8)]
      )
    )
    RETURNING id INTO v_id;

    IF v_status = 'declined' THEN
      INSERT INTO public.job_status_history (job_id, from_status, to_status, changed_by_worker_id, notes, created_at)
      VALUES (v_id, 'assigned', 'declined', v_workers[1 + (i % 4)], v_decline[1 + (i % 3)], now() - interval '3 hours');
    ELSIF v_status = 'incomplete' THEN
      -- Same shape the real trigger writes: which question blocked completion.
      INSERT INTO public.job_status_history (job_id, from_status, to_status, changed_by_worker_id, notes, metadata, created_at)
      VALUES (v_id, 'in_progress', 'incomplete', v_w, 'Report submitted — work not completed',
        jsonb_build_object('blocked_by', CASE WHEN i % 2 = 0 THEN 'walk_away' ELSE 'job_completed' END),
        v_start + interval '50 minutes');
    END IF;
  END LOOP;

  RAISE NOTICE 'Pro test data added to "%" (workers 5, customers 6, jobs 45). New look is on.', v_name;
END $$;
