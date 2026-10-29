-- SSE-style demo jobs for the customer portal (2026-10-28).
--
-- Fills ONE customer in your Eden Technologies business with realistic jobs so the new
-- customer portal (Your jobs home, job page, PDF report, export) can be shown with real
-- numbers:
--   * today: one completed, one in progress, one booked
--   * coming up: four booked / waiting jobs over the next days
--   * needs attention: two NOT COMPLETED jobs (with reasons and photos) and one OVERDUE job
--   * 12 completed jobs over the last four weeks, so the completion rate is a real number
--
-- The customer is found from the portal login (tayloreden2006@gmail.com), or by that
-- email on the customer record. It stops with an error unless that matches exactly ONE
-- customer and that customer belongs to Eden Technologies.
--
-- HOW TO USE
--   1. Paste this whole file into the Supabase SQL Editor and run it ONCE.
--   2. Photos are the little drawings in workwise_web/public/design-preview/. They are
--      served by the app itself, so v_base below must be where the app runs:
--      http://localhost:3001 while you demo from your laptop. If you demo from a deployed
--      address, change v_base to that address first.
--   3. Sign in to the portal as tayloreden2006@gmail.com.
--
-- SAFE BY DESIGN
--   * It only adds rows for that one customer. It changes nothing else.
--   * Rows go straight into the tables. Nothing calls the app, so no emails, texts or
--     push notifications are sent.
--   * Every job reference starts with 'SSE-DEMO-'. To undo it all, paste
--     sse-demo-portal-remove.sql.
--   * If Eden Technologies has an active worker, that worker is shown as the engineer on
--     the booked, in-progress and finished jobs (so the portal can show a first name).
--     It does not create or change any worker. With no worker, the engineer line is
--     simply left out.
--
-- Dates are built from today. Remove and re-run to freshen them.

DO $$
DECLARE
  v_email constant text := 'tayloreden2006@gmail.com';
  v_base  constant text := 'http://localhost:3001';

  v_n        int;
  v_customer uuid;
  v_tenant   uuid;
  v_worker   uuid;
  v_id       uuid;

  v_specs jsonb;
  v_spec  jsonb;

  v_status text;
  v_date   date;
  v_time   time;
  v_start  timestamptz;
  v_arrive timestamptz;
  v_finish timestamptz;
  v_created timestamptz;
  v_updated timestamptz;
  v_industry jsonb;
  v_key    text;
  v_k      int;
  v_assigned boolean;

  v_streets text[] := ARRAY[
    '3 Mill Lane, Reading RG1 2AQ','Unit 6, Harbour Point, Cardiff CF10 4PA','41 Priory Road, Bristol BS8 1TZ',
    'Beacon House, Swindon SN1 1AA','12 Quay Street, Exeter EX4 3LS','Greenfield Works, Oxford OX4 2JY',
    '22 Castle Terrace, Chester CH1 2AB','The Old Dairy, Ludlow SY8 1AB','2 Kingsway Retail Park, Derby DE22 3AF',
    '9 Albion Court, Nottingham NG1 5AA','Unit 2, Tannery Yard, Leicester LE1 4PL','14 Station Road, Lincoln LN5 7SF'
  ];
  v_work text[] := ARRAY[
    'Replace the cylinder on the rear plant-room door.',
    'Gain entry to a locked meter cupboard and leave it secure.',
    'Fit a new night latch to the main entrance.',
    'Repair a loose door handle and re-align the latch.',
    'Replace a broken padlock hasp on the yard gate.',
    'Lock out. Keys lost to the meter room.'
  ];
  v_done_notes text[] := ARRAY[
    'Done and tested. Keys handed to the site manager.',
    'Cylinder replaced like for like. Door secure.',
    'Latch re-aligned and tested three times.',
    'New hasp fitted and the gate locks cleanly.',
    'Entry gained without damage, new keys cut and left on site.'
  ];
  v_photo_names jsonb := '{"shutter":"Shutter, front","doorway":"Side entrance","cylinder":"Lock fitted"}'::jsonb;
BEGIN
  -- ---- find exactly one Eden Technologies customer -------------------------
  SELECT count(DISTINCT c.id) INTO v_n
    FROM public.customers c
    JOIN public.tenants t ON t.id = c.tenant_id
    LEFT JOIN public.customer_portal_users cpu ON cpu.customer_id = c.id
    LEFT JOIN auth.users u ON u.id = cpu.user_id
   WHERE regexp_replace(lower(t.name), '\s', '', 'g') = 'edentechnologies'
     AND (lower(u.email) = lower(v_email) OR lower(c.email) = lower(v_email));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one Eden Technologies customer linked to % but found %. Check the email and that the customer has portal access.', v_email, v_n;
  END IF;

  SELECT DISTINCT c.id, c.tenant_id INTO v_customer, v_tenant
    FROM public.customers c
    JOIN public.tenants t ON t.id = c.tenant_id
    LEFT JOIN public.customer_portal_users cpu ON cpu.customer_id = c.id
    LEFT JOIN auth.users u ON u.id = cpu.user_id
   WHERE regexp_replace(lower(t.name), '\s', '', 'g') = 'edentechnologies'
     AND (lower(u.email) = lower(v_email) OR lower(c.email) = lower(v_email));

  IF EXISTS (SELECT 1 FROM public.jobs WHERE customer_id = v_customer AND reference_number LIKE 'SSE-DEMO-%') THEN
    RAISE EXCEPTION 'The SSE demo jobs are already on this customer. Run sse-demo-portal-remove.sql first to refresh them.';
  END IF;

  SELECT wt.worker_id INTO v_worker
    FROM public.worker_tenants wt
   WHERE wt.tenant_id = v_tenant AND wt.status = 'active'
   ORDER BY wt.added_at NULLS LAST
   LIMIT 1;

  -- ---- the jobs -------------------------------------------------------------
  -- d = days from today, t = start time, s = status, r = reason not completed,
  -- c = engineer's note, ph = photos (shutter, doorway, cylinder).
  v_specs := $j$[
    {"d":0,"t":"09:00","s":"completed","a":"17 Mill Lane, Reading","p":"RG1 2AQ",
     "w":"Gain entry and fit a new euro cylinder on the rear plant-room door. Leave two keys with the site manager.",
     "c":"Cylinder replaced like for like. Two keys handed to the site manager, who signed for them.","ph":["doorway","cylinder"]},
    {"d":0,"t":"11:30","s":"in_progress","a":"Unit 9, Harbour Point, Cardiff","p":"CF10 4PA",
     "w":"Lock out. The meter cupboard door will not open."},
    {"d":0,"t":"14:00","s":"assigned","a":"5 Chapel Row, Bath","p":"BA1 1HU",
     "w":"Replace the broken padlock hasp on the yard gate."},
    {"d":1,"t":"09:00","s":"assigned","a":"41 Priory Road, Bristol","p":"BS8 1TZ",
     "w":"Lock out. Keys to the meter cupboard have been lost."},
    {"d":1,"t":"13:00","s":"assigned","a":"Beacon House, Swindon","p":"SN1 1AA",
     "w":"Fit a new night latch to the main entrance."},
    {"d":2,"s":"assigned","a":"12 Quay Street, Exeter","p":"EX4 3LS",
     "w":"Gain entry to a locked meter room and leave it secure."},
    {"d":4,"t":"10:30","s":"pending","a":"Greenfield Works, Oxford","p":"OX4 2JY",
     "w":"Replace a worn cylinder on the goods-in door."},
    {"d":-1,"t":"13:30","s":"incomplete","a":"Unit 4, Brindley Court, Wolverhampton","p":"WV10 0AB",
     "w":"Gain entry to the meter room behind the roller shutter and leave the premises secure.",
     "r":"No access. The roller shutter was locked and nobody was on site. Rang the site contact twice with no answer.",
     "c":"Left a card through the side door.","ph":["shutter","doorway","cylinder"]},
    {"d":-2,"t":"10:00","s":"incomplete","a":"Flat 12, Orchard House, Leeds","p":"LS6 2QB",
     "w":"Replace the cylinder on the communal entrance door.",
     "r":"Needs a part we did not have. The cylinder is a non-standard 70mm and has been ordered.",
     "c":"Door left secure with the existing lock.","ph":["cylinder"]},
    {"d":-3,"t":"09:00","s":"assigned","a":"88 Canal Street, Stoke-on-Trent","p":"ST1 5AA",
     "w":"Fit a replacement lock to the rear fire door."}
  ]$j$::jsonb;

  -- Twelve completed jobs over the last four weeks, for the completion rate.
  v_specs := v_specs || (
    SELECT jsonb_agg(jsonb_build_object(
             'd', -(ARRAY[2,3,5,6,8,10,12,15,18,21,24,27])[g],
             't', (ARRAY['08:30','09:30','10:00','11:00','13:00','14:30'])[1 + (g % 6)],
             's', 'completed',
             'a', split_part(v_streets[g], ',', 1) || ',' || split_part(v_streets[g], ',', 2),
             'p', right(v_streets[g], 8),
             'w', v_work[1 + (g % 6)],
             'c', v_done_notes[1 + (g % 5)],
             'ph', CASE WHEN g % 3 = 0 THEN '["doorway"]'::jsonb WHEN g % 3 = 1 THEN '["cylinder"]'::jsonb ELSE '[]'::jsonb END))
      FROM generate_series(1, 12) AS g
  );

  FOR v_spec, v_k IN SELECT value, ord::int FROM jsonb_array_elements(v_specs) WITH ORDINALITY AS t(value, ord) LOOP
    v_status := v_spec ->> 's';
    v_date := current_date + (v_spec ->> 'd')::int;
    v_time := CASE WHEN v_spec ? 't' THEN (v_spec ->> 't')::time ELSE NULL END;
    v_start := CASE WHEN v_time IS NULL THEN NULL ELSE (v_date + v_time)::timestamp AT TIME ZONE 'Europe/London' END;
    v_arrive := CASE WHEN v_status = 'in_progress' THEN v_start - interval '6 minutes'
                     WHEN v_status IN ('completed','incomplete') THEN v_start - interval '8 minutes' END;
    v_finish := CASE WHEN v_status = 'completed' THEN v_start + interval '45 minutes' END;
    v_created := COALESCE(v_start, v_date::timestamp AT TIME ZONE 'Europe/London') - interval '3 days';
    v_updated := CASE WHEN v_status = 'completed' THEN v_finish
                      WHEN v_status = 'incomplete' THEN v_start + interval '32 minutes'
                      WHEN v_status = 'in_progress' THEN v_start
                      ELSE v_created END;
    v_assigned := v_worker IS NOT NULL AND v_status IN ('assigned','in_progress','completed','incomplete');

    v_industry := CASE v_status
      WHEN 'completed'  THEN jsonb_build_object('job_completed', true, 'job_notes', v_spec ->> 'c')
      WHEN 'incomplete' THEN jsonb_build_object('job_completed', false, 'incomplete_reason', v_spec ->> 'r', 'job_notes', v_spec ->> 'c')
      ELSE '{}'::jsonb END;

    INSERT INTO public.jobs (
      tenant_id, reference_number, customer_id, assigned_worker_id, address, postcode,
      job_description, status, priority, scheduled_date, scheduled_time, estimated_duration_minutes,
      started_at, arrived_at, completed_at, completion_notes, industry_data, source_fields,
      created_at, updated_at
    ) VALUES (
      v_tenant, 'SSE-DEMO-' || lpad(v_k::text, 3, '0'), v_customer,
      CASE WHEN v_assigned THEN v_worker END,
      v_spec ->> 'a', v_spec ->> 'p',
      v_spec ->> 'w', v_status::public.job_status, 'normal'::public.job_priority,
      v_date, v_time, 45,
      CASE WHEN v_status IN ('in_progress','completed','incomplete') THEN v_start END,
      v_arrive, v_finish,
      CASE WHEN v_status IN ('completed','incomplete') THEN v_spec ->> 'c' END,
      v_industry,
      jsonb_build_object('Work Order', 'WO-' || (700100 + v_k), 'Site Contact', '07700 900' || lpad(v_k::text, 3, '0')),
      v_created, v_updated
    )
    RETURNING id INTO v_id;

    -- The story, in the same shape the app writes it.
    IF v_status <> 'pending' THEN
      INSERT INTO public.job_status_history (job_id, from_status, to_status, changed_by_worker_id, notes, metadata, created_at)
      VALUES (v_id, 'pending'::public.job_status, 'assigned'::public.job_status, NULL, NULL, '{}'::jsonb, v_created + interval '1 day');
    END IF;
    IF v_status IN ('in_progress','completed','incomplete') THEN
      INSERT INTO public.job_status_history (job_id, from_status, to_status, changed_by_worker_id, notes, metadata, created_at)
      VALUES (v_id, 'assigned'::public.job_status, 'in_progress'::public.job_status,
              CASE WHEN v_assigned THEN v_worker END, NULL, '{}'::jsonb, v_start);
    END IF;
    IF v_status = 'completed' THEN
      INSERT INTO public.job_status_history (job_id, from_status, to_status, changed_by_worker_id, notes, metadata, created_at)
      VALUES (v_id, 'in_progress'::public.job_status, 'completed'::public.job_status,
              CASE WHEN v_assigned THEN v_worker END, 'Report submitted', '{}'::jsonb, v_finish);
    ELSIF v_status = 'incomplete' THEN
      INSERT INTO public.job_status_history (job_id, from_status, to_status, changed_by_worker_id, notes, metadata, created_at)
      VALUES (v_id, 'in_progress'::public.job_status, 'incomplete'::public.job_status,
              CASE WHEN v_assigned THEN v_worker END, 'Report submitted — work not completed',
              jsonb_build_object('blocked_by', 'job_completed'), v_updated);
    END IF;

    -- Photos taken at the visit.
    IF v_spec ? 'ph' THEN
      FOR v_key IN SELECT jsonb_array_elements_text(v_spec -> 'ph') LOOP
        INSERT INTO public.job_attachments (job_id, file_url, file_name, file_type, attachment_type, created_at)
        VALUES (v_id, v_base || '/design-preview/' || v_key || '.svg', v_photo_names ->> v_key,
                'image/svg+xml', 'photo', COALESCE(v_arrive, v_start, v_created) + interval '12 minutes');
      END LOOP;
    END IF;
  END LOOP;

  RAISE NOTICE 'Added % SSE demo jobs to the customer linked to % (worker shown as engineer: %).',
    jsonb_array_length(v_specs), v_email, COALESCE(v_worker::text, 'none');
END $$;
