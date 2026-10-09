-- GoCardless review demo data for the business "Clearview Windows".
--
-- WHAT IT DOES
--   Adds 4 customers to the demo trader you sign up as "Clearview Windows"
--   (sign up first at localhost:3000/signup, test mode, business name exactly
--   "Clearview Windows"). Each has one fortnightly £15 window clean.
--
--   Customer            Used for                                   Visit
--   Successful Carter   Direct Debit set-up, then collect          due TODAY (mark it Done)
--   Penniless Evans     Direct Debit that FAILS (sandbox)          due TODAY (mark it Done)
--   Successful Hughes   Pay by bank                                done last week, owes £15
--   Successful Baker    "Pay now by bank and set up Direct Debit"  done last week, owes £15
--
--   The first name is on purpose: GoCardless's sandbox reads it to decide what
--   happens (Successful = works, Penniless = payment fails).
--
-- BEFORE YOU PASTE: change the two lines marked CHANGE ME so the emails go to an
-- inbox you can read (e.g. you+carter@gmail.com). WorkWise sends real emails
-- (visit done, Direct Debit link) to these addresses.
--
-- SAFE: only touches the tenant named "Clearview Windows". Every row is tagged
-- '[gc-demo]'. Run it ONCE; to start again paste gocardless-demo-remove.sql first.
-- Nothing calls the app: no texts, emails or payments are sent by pasting this.

DO $$
DECLARE
  v_inbox  constant text := 'tayloreden2006';   -- CHANGE ME: the part before the @ (e.g. taylor)
  v_domain constant text := 'gmail.com';  -- CHANGE ME: the part after the @
  v_tag    constant text := '[gc-demo]';

  v_tenant uuid;
  v_worker uuid;
  v_svc uuid;
  v_names text[] := ARRAY['Successful Carter','Penniless Evans','Successful Hughes','Successful Baker'];
  v_tags  text[] := ARRAY['carter','evans','hughes','baker'];
  v_streets text[] := ARRAY['12 Elm Road','4 Beech Avenue','27 Maple Close','9 Ash Grove'];
  v_pcs text[] := ARRAY['M20 2AB','M20 3CD','M14 4EF','M20 5OP'];
  i int;
  v_cid uuid;
  v_aid uuid;
  v_date date;
  v_status text;
BEGIN
  IF v_inbox = 'yourname' THEN
    RAISE EXCEPTION 'Edit the two CHANGE ME lines first (your email). Nothing was changed.';
  END IF;

  SELECT id INTO v_tenant FROM public.tenants WHERE name = 'Clearview Windows';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No business called "Clearview Windows". Sign up as that first. Nothing was changed.';
  END IF;
  IF (SELECT count(*) FROM public.tenants WHERE name = 'Clearview Windows') > 1 THEN
    RAISE EXCEPTION 'More than one "Clearview Windows" exists. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.customers WHERE tenant_id = v_tenant AND notes LIKE v_tag || '%') THEN
    RAISE EXCEPTION 'Demo rows already exist. Paste gocardless-demo-remove.sql first. Nothing was changed.';
  END IF;

  SELECT id INTO v_worker FROM public.workers WHERE primary_tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  SELECT id INTO v_svc FROM public.service_catalog WHERE tenant_id = v_tenant ORDER BY sort_order, name LIMIT 1;

  FOR i IN 1..4 LOOP
    v_cid := gen_random_uuid();
    INSERT INTO public.customers (
      id, tenant_id, name, type, phone, phone_e164, email, notes,
      payment_terms, preferred_channel, is_active
    ) VALUES (
      v_cid, v_tenant, v_names[i], 'individual',
      '07700 900' || lpad((100 + i)::text, 3, '0'), '+447700900' || lpad((100 + i)::text, 3, '0'),
      v_inbox || '+' || v_tags[i] || '@' || v_domain,
      v_tag || ' ' || v_names[i],
      'on_the_day', 'sms', true
    );

    -- Carter and Evans: visit due today. Hughes and Baker: visit done a week ago, unpaid.
    v_date := CASE WHEN i <= 2 THEN current_date ELSE current_date - 7 END;
    v_status := CASE WHEN i <= 2 THEN 'assigned' ELSE 'completed' END;

    v_aid := gen_random_uuid();
    INSERT INTO public.service_agreements (
      id, tenant_id, customer_id, service_catalog_id, title,
      address, postcode, price, duration_minutes, frequency_days,
      anchor_date, preferred_weekday, preferred_time, schedule_mode,
      next_due_date, status, assigned_worker_id, reminder_enabled, notes
    ) VALUES (
      v_aid, v_tenant, v_cid, v_svc, 'Window clean (front & back)',
      v_streets[i], v_pcs[i], 15, 30, 14,
      v_date, extract(isodow FROM v_date)::int, time '09:00' + (i * interval '30 minutes'), 'fixed',
      CASE WHEN i <= 2 THEN v_date ELSE v_date + 14 END, 'active', v_worker, true, v_tag
    );

    INSERT INTO public.jobs (
      tenant_id, reference_number, customer_id, assigned_worker_id,
      service_agreement_id, agreement_occurrence_date,
      address, postcode, job_description,
      status, priority, scheduled_date, scheduled_time, estimated_duration_minutes,
      quoted_amount, final_amount, payment_status, route_position,
      required_skills, industry_data, source_fields, custom_fields, completed_at
    ) VALUES (
      v_tenant, 'GC-' || i || '-' || to_char(v_date, 'YYMMDD'), v_cid, v_worker,
      v_aid, v_date,
      v_streets[i], v_pcs[i], 'Window clean (front & back)',
      v_status::public.job_status, 'normal', v_date, time '09:00' + (i * interval '30 minutes'), 30,
      15, CASE WHEN v_status = 'completed' THEN 15 END, 'unpaid', i,
      '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
      jsonb_build_object('rounds', jsonb_build_object('seed', 'gc-demo', 'agreement_id', v_aid)),
      CASE WHEN v_status = 'completed' THEN now() - interval '7 days' END
    );
  END LOOP;

  RAISE NOTICE 'GoCardless demo data added to Clearview Windows (4 customers).';
END $$;
