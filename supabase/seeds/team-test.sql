-- Team-test data for the Phase 9 walkthrough (step 34).
--
-- Adds 24 customers on a Rounds business, each with a weekly or fortnightly agreement:
--   * "Monday north"  9 houses (Leeds LS6 / LS7 / LS8 / LS16)  - Mondays
--   * "Tuesday south" 9 houses (Leeds LS10 / LS11 / LS12)      - Tuesdays (6 of them have a visit TODAY if today is a Tuesday)
--   * 6 houses in no round                                      - Wednesday, Thursday, Friday (2 each)
-- and the visits from today until Friday of next week, all given to the owner.
--
-- SAFE BY DESIGN
--   * It only touches the one business whose slug is at the top (it stops if the slug is wrong).
--   * Rows are inserted straight into the tables. Nothing calls the app, so no texts, emails or payments are sent.
--   * Every row is findable: customers.notes, agreements.notes start with '[team-test]'; visit references start with 'TT-'.
--   * Run it ONCE. If it finds [team-test] rows it stops. To remove it first, paste team-test-remove.sql.

DO $$
DECLARE
  v_slug  constant text := 'team-test-cleaning';
  v_tag   constant text := '[team-test]';

  v_tenant uuid;
  v_worker uuid;
  v_round_m uuid;
  v_round_t uuid;
  v_svc uuid[];

  v_names text[] := ARRAY[
    'Margaret Ellis','Raj Patel','Hannah Cooper','Owen Pritchard','Grace Okafor','Liam Turner',
    'Fiona McKay','Samir Haddad','Beth Harrison',
    'Callum Ross','Joanne Lowe','Mohammed Ali','Ruth Sinclair','Gareth Hughes','Amara Nwosu',
    'Peter Walsh','Eleanor Fox','Kwame Mensah',
    'Diane Foster','Stuart Bell','Yasmin Qureshi','Colin Marsh','Tessa Brennan','Arjun Mehta'
  ];
  v_streets text[] := ARRAY[
    'Otley Road','Cardigan Road','Headingley Lane','Hyde Park Road','Chapel Allerton Road','Roundhay Road','Street Lane','Harehills Lane','Alwoodley Lane',
    'Dewsbury Road','Beeston Road','Elland Road','Town Street','Tong Road','Wortley Lane','Domestic Road','Theodore Street','Ring Road',
    'Stanningley Road','Kirkstall Road','Cookridge Lane','Pudsey Road','Moortown Corner','Meanwood Road'
  ];
  v_pcs text[] := ARRAY[
    'LS6 1PA','LS6 2AB','LS6 3HN','LS6 1JT','LS7 3QD','LS8 4DY','LS8 2LF','LS8 5JQ','LS16 7DE',
    'LS11 8AD','LS11 7DT','LS11 0ES','LS11 5HT','LS12 1AA','LS12 3RB','LS11 9QE','LS10 2BQ','LS10 4AW',
    'LS13 2AB','LS5 3BJ','LS16 6RS','LS28 7LP','LS17 7ZZ','LS6 4AE'
  ];
  v_prices numeric[] := ARRAY[12,15,18,20,22,25,14,16,30,18,12,15,20,22,25,28,16,18,15,20,22,18,25,14];
  v_titles text[] := ARRAY['Window clean (front)','Window clean (front & back)','Windows and conservatory'];

  i int;
  j int;
  v_wd int;
  v_freq int;
  v_base date;
  v_d0 date;
  v_end date;
  v_price numeric;
  v_title text;
  v_time time;
  v_cid uuid;
  v_aid uuid;
  v_round uuid;
  v_addr text;
  v_name text;
  r record;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = v_slug;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No business with the slug "%". Put the right slug at the top of this file. Nothing was changed.', v_slug;
  END IF;
  IF EXISTS (SELECT 1 FROM public.customers WHERE tenant_id = v_tenant AND notes LIKE v_tag || '%') THEN
    RAISE EXCEPTION 'Team-test rows already exist. Paste team-test-remove.sql first. Nothing was changed.';
  END IF;

  SELECT id INTO v_worker FROM public.workers
   WHERE primary_tenant_id = v_tenant AND worker_type = 'platform_solo'
   ORDER BY created_at LIMIT 1;
  IF v_worker IS NULL THEN
    RAISE EXCEPTION 'This business has no owner worker row (platform_solo). Is it a Rounds business? Nothing was changed.';
  END IF;

  SELECT array_agg(id ORDER BY sort_order, name) INTO v_svc
    FROM public.service_catalog WHERE tenant_id = v_tenant;

  INSERT INTO public.rounds (tenant_id, name, colour) VALUES (v_tenant, 'Monday north', '#2563eb') RETURNING id INTO v_round_m;
  INSERT INTO public.rounds (tenant_id, name, colour) VALUES (v_tenant, 'Tuesday south', '#16a34a') RETURNING id INTO v_round_t;

  -- Friday of next week
  v_end := current_date + ((5 - extract(isodow FROM current_date)::int + 7) % 7) + 7;

  FOR i IN 1..24 LOOP
    v_name := v_names[i];
    IF i <= 9 THEN
      v_wd := 1; j := i; v_round := v_round_m;
    ELSIF i <= 18 THEN
      v_wd := 2; j := i - 9; v_round := v_round_t;
    ELSE
      v_wd := 3 + ((i - 19) / 2); j := i - 18; v_round := NULL;   -- 19,20 Wed; 21,22 Thu; 23,24 Fri
    END IF;

    v_base := current_date + ((v_wd - extract(isodow FROM current_date)::int + 7) % 7);
    -- Weekly for the first six of each round; fortnightly after that. Tuesday's fortnightly houses start next week,
    -- so today has six stops and next Tuesday has nine.
    IF j <= 6 THEN
      v_freq := 7;  v_d0 := v_base;
    ELSE
      v_freq := 14; v_d0 := CASE WHEN v_wd = 2 THEN v_base + 7 ELSE v_base END;
    END IF;
    IF v_wd >= 3 THEN v_freq := 7; v_d0 := v_base; END IF;

    v_price := v_prices[i];
    v_title := v_titles[(i % 3) + 1];
    v_time := time '09:00' + (j * interval '20 minutes');
    v_addr := (2 + (i * 7) % 60) || ' ' || v_streets[i];

    v_cid := gen_random_uuid();
    INSERT INTO public.customers (
      id, tenant_id, name, type, phone, phone_e164, email, notes,
      payment_terms, preferred_channel, access_notes, is_active
    ) VALUES (
      v_cid, v_tenant, v_name, 'individual',
      '07700 900' || lpad((100 + i)::text, 3, '0'), '+447700900' || lpad((100 + i)::text, 3, '0'),
      CASE WHEN i % 2 = 0 THEN lower(replace(v_name, ' ', '.')) || '@example.com' END,
      v_tag || ' #' || i,
      'on_the_day', 'sms',
      CASE i % 6 WHEN 0 THEN 'Side gate, dog friendly' WHEN 1 THEN 'Park on the drive' WHEN 4 THEN 'Keys with neighbour' END,
      true
    );

    v_aid := gen_random_uuid();
    INSERT INTO public.service_agreements (
      id, tenant_id, customer_id, service_catalog_id, title,
      address, postcode, price, duration_minutes, frequency_days,
      anchor_date, preferred_weekday, preferred_time, schedule_mode,
      next_due_date, status, assigned_worker_id, reminder_enabled, notes, round_id
    ) VALUES (
      v_aid, v_tenant, v_cid,
      CASE WHEN v_svc IS NULL THEN NULL ELSE v_svc[((i - 1) % array_length(v_svc, 1)) + 1] END,
      v_title, v_addr, v_pcs[i], v_price, 20 + (i % 3) * 10, v_freq,
      v_d0 - 28, v_wd, v_time, 'fixed',
      v_d0, 'active', v_worker, true, v_tag, v_round
    );

    FOR r IN
      SELECT d::date AS d
        FROM generate_series(v_d0::timestamp, v_end::timestamp, make_interval(days => v_freq)) AS d
    LOOP
      INSERT INTO public.jobs (
        id, tenant_id, reference_number, customer_id, assigned_worker_id,
        service_agreement_id, agreement_occurrence_date,
        address, postcode, job_description,
        status, priority, scheduled_date, scheduled_time, estimated_duration_minutes,
        quoted_amount, payment_status, route_position,
        required_skills, industry_data, source_fields, custom_fields
      ) VALUES (
        gen_random_uuid(), v_tenant, 'TT-' || lpad(i::text, 3, '0') || '-' || to_char(r.d, 'YYMMDD'),
        v_cid, v_worker, v_aid, r.d,
        v_addr, v_pcs[i], v_title,
        'assigned'::public.job_status, 'normal', r.d, v_time, 20 + (i % 3) * 10,
        v_price, 'unpaid', j,
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        jsonb_build_object('rounds', jsonb_build_object('seed', 'team-test', 'agreement_id', v_aid))
      );
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Team-test data added to "%": 24 customers, 2 rounds, visits from today to %.', v_slug, v_end;
END $$;

-- Check: expect 24 customers, 24 agreements, 2 rounds, and visits per day listed below.
SELECT 'customers' AS what, count(*)::text AS n FROM public.customers c JOIN public.tenants t ON t.id = c.tenant_id WHERE t.slug = 'team-test-cleaning' AND c.notes LIKE '[team-test]%'
UNION ALL
SELECT to_char(j.scheduled_date, 'Dy DD Mon'), count(*)::text
  FROM public.jobs j JOIN public.tenants t ON t.id = j.tenant_id
 WHERE t.slug = 'team-test-cleaning' AND j.reference_number LIKE 'TT-%'
 GROUP BY j.scheduled_date ORDER BY 1;
