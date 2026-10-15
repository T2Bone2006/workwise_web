-- Look-test data for the business "Test rounds 2" (Phase 7b step 1).
--
-- Adds a realistic window-cleaning round so every redesigned page can be judged
-- with real numbers: 40 customers, 40 agreements, ~12 weeks of visits (past and
-- next 4 weeks, a few skipped), payments (cash / card / Direct Debit / bank /
-- cheque / pay by bank), invoices (paid, sent, overdue), 8 text conversations
-- (5 with a reply waiting for you), 15 expenses, and, only if this business
-- already has a widget set up, 8 leads and 12 conversations.
--
-- SAFE BY DESIGN
--   * It only touches the tenant 'Test rounds 2' (id and name are both checked
--     first; it stops with an error otherwise). No other business is touched.
--   * Rows are inserted straight into the tables. Nothing calls the app, so no
--     texts, emails, Direct Debits or card payments are sent or taken.
--   * Every row is findable: customers.notes, agreements.notes, payments.note,
--     expenses.note, invoices.footer, leads.notes start with '[look-test]';
--     visit references start with 'LT-'.
--   * Run it ONCE. If it finds [look-test] rows it stops. To remove it all
--     first, paste look-test-rounds2-remove.sql.
--   * Money is calculated by the app's own database engine (payments are
--     matched to visits oldest first), so "owed" numbers are genuine.
--
-- Dates are built from today, so Today, the week and the month all have content.
-- Re-run the remove file and this one in a few weeks to freshen the dates.

DO $$
DECLARE
  v_tenant constant uuid := 'f571681c-3054-4836-8086-11c1777fc4ea';
  v_worker constant uuid := '09c51516-ea52-4bdf-9980-c002429f615e';
  v_tag    constant text := '[look-test]';

  v_names text[] := ARRAY[
    'Margaret Ellis','Raj Patel','Hannah Cooper','Owen Pritchard','Grace Okafor',
    'Liam Turner','Fiona McKay','Samir Haddad','Beth Harrison','Callum Ross',
    'Joanne Lowe','Mohammed Ali','Ruth Sinclair','Gareth Hughes','Amara Nwosu',
    'Peter Walsh','Eleanor Fox','Kwame Mensah','Diane Foster','Stuart Bell',
    'Yasmin Qureshi','Colin Marsh','Tessa Brennan','Arjun Mehta','Lorraine Kay',
    'Declan Murphy','Naomi Stein','Barry Dunn','Chloe Atkinson','Imran Sheikh',
    'Pauline Rhodes','Jack Whitfield','Sofia Rossi','Terry Gibbs','Katie Doyle',
    'Anil Kumar','Wendy Pearce','Lewis Grant','Maria Santos','Harold Finch'
  ];
  v_streets text[] := ARRAY[
    'Lapwing Lane','Brook Road','Mauldeth Road','Albany Road','Lindow Grove',
    'Fog Lane','Kingsway','Parsonage Road','Egerton Road','Cavendish Road'
  ];
  v_pcs text[] := ARRAY[
    'M20 2PQ','M20 3GH','M20 4LJ','M20 6AD','M20 1EL',
    'M20 5BT','M14 6NS','M14 7QA','M14 5TY','M20 2WX'
  ];
  v_prices numeric[] := ARRAY[12,15,18,22,25,30,18,35,15,20];
  v_methods text[] := ARRAY['cash','cash','card','direct_debit','bank_transfer','pay_by_bank','cheque'];
  v_svc uuid[];

  i int;
  v_cid uuid;
  v_aid uuid;
  v_jid uuid;
  v_wd int;
  v_fr int;
  v_price numeric;
  v_anchor date;
  v_time time;
  v_title text;
  v_status text;
  v_skip text;
  v_method text;
  v_source text;
  v_owing boolean;
  v_monthly boolean;
  v_received timestamptz;
  v_completed timestamptz;
  v_inv uuid;
  v_total numeric;
  v_count int;
  v_issue date;
  v_due date;
  v_last_date date;
  v_last_job uuid;
  v_name text;
  v_phone text;
  r record;
  v_thread uuid;
  v_next_job uuid;
  v_next_date date;
  v_first text;
  v_client uuid;
  v_conv uuid;
  v_convs uuid[] := ARRAY[]::uuid[];
BEGIN
  -- Guards -------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_tenant AND name = 'Test rounds 2') THEN
    RAISE EXCEPTION 'Expected the tenant "Test rounds 2" with id %. Nothing was changed.', v_tenant;
  END IF;
  IF EXISTS (SELECT 1 FROM public.customers WHERE tenant_id = v_tenant AND notes LIKE v_tag || '%') THEN
    RAISE EXCEPTION 'Look-test rows already exist. Paste look-test-rounds2-remove.sql first. Nothing was changed.';
  END IF;

  SELECT array_agg(id ORDER BY sort_order, name) INTO v_svc
    FROM public.service_catalog WHERE tenant_id = v_tenant;

  -- Customers, agreements, visits, payments ----------------------------------
  FOR i IN 1..40 LOOP
    v_name := v_names[i];
    v_phone := '07700 900' || lpad(i::text, 3, '0');
    v_monthly := (i % 8 = 0);
    -- Customers who have not paid their last four weeks of visits yet.
    v_owing := (NOT v_monthly) AND (i % 5 = 0 OR i % 8 = 3);

    v_cid := gen_random_uuid();
    INSERT INTO public.customers (
      id, tenant_id, name, type, phone, phone_e164, email, notes,
      payment_terms, preferred_channel, access_notes, is_active
    ) VALUES (
      v_cid, v_tenant, v_name, 'individual', v_phone, '+447700900' || lpad(i::text, 3, '0'),
      CASE WHEN i % 2 = 0 THEN lower(replace(v_name, ' ', '.')) || '@example.com' END,
      v_tag || ' #' || i,
      CASE WHEN v_monthly THEN 'monthly_invoice' ELSE 'on_the_day' END,
      CASE WHEN i % 3 = 0 THEN 'whatsapp' ELSE 'sms' END,
      CASE i % 6 WHEN 0 THEN 'Side gate, dog friendly' WHEN 1 THEN 'Park on the drive' WHEN 4 THEN 'Keys with neighbour' END,
      true
    );

    v_wd := (i % 5) + 1;                              -- Monday to Friday
    v_fr := CASE WHEN i % 2 = 0 THEN 14 ELSE 28 END;  -- fortnightly or four-weekly
    v_price := v_prices[(i % 10) + 1];
    v_title := CASE WHEN v_price >= 30 THEN 'Windows, conservatory and gutters'
                    WHEN v_price >= 18 THEN 'Window clean (front & back)'
                    ELSE 'Window clean (front)' END;
    v_time := time '08:30' + ((i % 10) * interval '30 minutes');
    v_anchor := (current_date - 84)
      + ((v_wd - extract(isodow FROM (current_date - 84))::int + 7) % 7)
      + 7 * ((i / 2) % (v_fr / 7));

    v_aid := gen_random_uuid();
    INSERT INTO public.service_agreements (
      id, tenant_id, customer_id, service_catalog_id, title,
      address, postcode, price, duration_minutes, frequency_days,
      anchor_date, preferred_weekday, preferred_time, schedule_mode,
      next_due_date, status, assigned_worker_id, reminder_enabled, notes
    ) VALUES (
      v_aid, v_tenant, v_cid,
      CASE WHEN v_svc IS NULL THEN NULL ELSE v_svc[((i - 1) % array_length(v_svc, 1)) + 1] END,
      v_title,
      (2 + (i * 7) % 90) || ' ' || v_streets[(i % 10) + 1], v_pcs[(i % 10) + 1],
      v_price, 20 + (i % 3) * 10, v_fr,
      v_anchor, v_wd, v_time, 'fixed',
      (SELECT min(d)::date FROM generate_series(v_anchor::timestamp, (current_date + 60)::timestamp, make_interval(days => v_fr)) d WHERE d::date >= current_date),
      'active', v_worker, true, v_tag
    );

    v_method := v_methods[(i % 7) + 1];
    v_source := CASE v_method WHEN 'card' THEN 'stripe'
                              WHEN 'direct_debit' THEN 'gocardless'
                              WHEN 'pay_by_bank' THEN 'gocardless'
                              ELSE 'manual' END;

    FOR r IN
      SELECT d::date AS d
        FROM generate_series(v_anchor::timestamp, (current_date + 28)::timestamp, make_interval(days => v_fr)) AS d
    LOOP
      v_skip := NULL;
      IF r.d < current_date THEN
        IF (i + extract(day FROM r.d)::int) % 19 = 0 THEN
          v_status := 'cancelled'; v_skip := 'weather';
        ELSE
          v_status := 'completed';
        END IF;
      ELSIF r.d = current_date THEN
        v_status := CASE WHEN i % 2 = 0 THEN 'completed' ELSE 'assigned' END;
      ELSE
        v_status := 'assigned';
      END IF;

      v_completed := CASE WHEN v_status = 'completed'
        THEN least(((r.d + v_time) AT TIME ZONE 'Europe/London') + interval '30 minutes', now() - interval '10 minutes')
      END;

      v_jid := gen_random_uuid();
      INSERT INTO public.jobs (
        id, tenant_id, reference_number, customer_id, assigned_worker_id,
        service_agreement_id, agreement_occurrence_date,
        address, postcode, job_description,
        status, priority, scheduled_date, scheduled_time, estimated_duration_minutes,
        quoted_amount, final_amount, payment_status, route_position,
        required_skills, industry_data, source_fields, custom_fields,
        completed_at, skip_reason
      ) VALUES (
        v_jid, v_tenant, 'LT-' || lpad(i::text, 3, '0') || '-' || to_char(r.d, 'YYMMDD'),
        v_cid, v_worker, v_aid, r.d,
        (2 + (i * 7) % 90) || ' ' || v_streets[(i % 10) + 1], v_pcs[(i % 10) + 1], v_title,
        v_status::public.job_status, 'normal', r.d, v_time, 20 + (i % 3) * 10,
        v_price, CASE WHEN v_status = 'completed' THEN v_price END, 'unpaid', i,
        '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
        jsonb_build_object('rounds', jsonb_build_object('seed', 'look-test', 'agreement_id', v_aid)),
        v_completed, v_skip
      );

      -- Pay-as-you-go customers pay each completed visit, except the "owing"
      -- ones for the last four weeks. (Monthly customers pay by invoice below.)
      IF v_status = 'completed' AND NOT v_monthly AND (NOT v_owing OR r.d < current_date - 28) THEN
        v_received := least(
          ((r.d + time '13:00') AT TIME ZONE 'Europe/London')
            + (CASE WHEN v_method IN ('direct_debit', 'bank_transfer', 'pay_by_bank') THEN interval '2 days' ELSE interval '0' END)
            + (i % 5) * interval '10 minutes',
          now() - interval '5 minutes'
        );
        INSERT INTO public.payments (
          tenant_id, customer_id, amount, method, source, status, received_at, note, applies_to_job_id
        ) VALUES (
          v_tenant, v_cid, v_price, v_method, v_source, 'active', v_received, v_tag, v_jid
        );
      END IF;
    END LOOP;

    -- Monthly-invoice customers: last month's visits invoiced and paid, this
    -- month's invoiced and waiting (two of them overdue).
    IF v_monthly THEN
      -- Invoice A: completed visits older than 30 days, paid by bank transfer.
      SELECT coalesce(sum(quoted_amount), 0), count(*) INTO v_total, v_count
        FROM public.jobs
       WHERE tenant_id = v_tenant AND customer_id = v_cid AND status = 'completed'
         AND scheduled_date < current_date - 30;
      IF v_count > 0 THEN
        v_inv := gen_random_uuid();
        INSERT INTO public.invoices (
          id, tenant_id, customer_id, number, kind, status, issue_date, due_date,
          seller_name, bill_to_name, bill_to_email, payment_reference,
          subtotal_net, vat_amount, total, footer, public_token, sent_at, sent_to_email
        ) VALUES (
          v_inv, v_tenant, v_cid, 'LT-' || lpad(i::text, 3, '0') || 'A', 'balance', 'issued',
          current_date - 30, current_date - 16,
          'Test rounds 2', v_name, lower(replace(v_name, ' ', '.')) || '@example.com',
          'LT' || lpad(i::text, 3, '0') || 'A',
          v_total, 0, v_total, v_tag, md5(random()::text || clock_timestamp()::text || i || 'A'),
          (current_date - 30)::timestamptz + interval '9 hours', lower(replace(v_name, ' ', '.')) || '@example.com'
        );
        INSERT INTO public.invoice_lines (tenant_id, invoice_id, job_id, service_date, description, address, amount, sort_order)
        SELECT v_tenant, v_inv, j.id, j.scheduled_date, j.job_description, j.address, j.quoted_amount,
               row_number() OVER (ORDER BY j.scheduled_date)
          FROM public.jobs j
         WHERE j.tenant_id = v_tenant AND j.customer_id = v_cid AND j.status = 'completed'
           AND j.scheduled_date < current_date - 30;
        INSERT INTO public.payments (
          tenant_id, customer_id, amount, method, source, status, received_at, note, invoice_id
        ) VALUES (
          v_tenant, v_cid, v_total, 'bank_transfer', 'manual', 'active',
          (current_date - 20)::timestamptz + interval '11 hours', v_tag, v_inv
        );
      END IF;

      -- Invoice B: completed visits from the last 30 days, not paid yet.
      SELECT coalesce(sum(quoted_amount), 0), count(*) INTO v_total, v_count
        FROM public.jobs
       WHERE tenant_id = v_tenant AND customer_id = v_cid AND status = 'completed'
         AND scheduled_date >= current_date - 30;
      IF v_count > 0 THEN
        v_issue := CASE WHEN i IN (8, 16) THEN current_date - 16 ELSE current_date - 5 END;
        v_due   := CASE WHEN i IN (8, 16) THEN current_date - 2  ELSE current_date + 9 END;
        v_inv := gen_random_uuid();
        INSERT INTO public.invoices (
          id, tenant_id, customer_id, number, kind, status, issue_date, due_date,
          seller_name, bill_to_name, bill_to_email, payment_reference,
          subtotal_net, vat_amount, total, footer, public_token, sent_at, sent_to_email
        ) VALUES (
          v_inv, v_tenant, v_cid, 'LT-' || lpad(i::text, 3, '0') || 'B', 'balance', 'issued',
          v_issue, v_due,
          'Test rounds 2', v_name, lower(replace(v_name, ' ', '.')) || '@example.com',
          'LT' || lpad(i::text, 3, '0') || 'B',
          v_total, 0, v_total, v_tag, md5(random()::text || clock_timestamp()::text || i || 'B'),
          v_issue::timestamptz + interval '9 hours', lower(replace(v_name, ' ', '.')) || '@example.com'
        );
        INSERT INTO public.invoice_lines (tenant_id, invoice_id, job_id, service_date, description, address, amount, sort_order)
        SELECT v_tenant, v_inv, j.id, j.scheduled_date, j.job_description, j.address, j.quoted_amount,
               row_number() OVER (ORDER BY j.scheduled_date)
          FROM public.jobs j
         WHERE j.tenant_id = v_tenant AND j.customer_id = v_cid AND j.status = 'completed'
           AND j.scheduled_date >= current_date - 30;
      END IF;
    END IF;

    -- A single-visit invoice for some of the customers who owe money.
    IF NOT v_monthly AND i % 8 = 3 THEN
      SELECT j.id, j.scheduled_date INTO v_last_job, v_last_date
        FROM public.jobs j
       WHERE j.tenant_id = v_tenant AND j.customer_id = v_cid AND j.status = 'completed'
         AND j.scheduled_date >= current_date - 28
       ORDER BY j.scheduled_date DESC LIMIT 1;
      IF v_last_job IS NOT NULL THEN
        v_inv := gen_random_uuid();
        INSERT INTO public.invoices (
          id, tenant_id, customer_id, number, kind, status, issue_date, due_date,
          seller_name, bill_to_name, bill_to_email, payment_reference,
          subtotal_net, vat_amount, total, footer, public_token, sent_at, sent_to_email
        ) VALUES (
          v_inv, v_tenant, v_cid, 'LT-' || lpad(i::text, 3, '0') || 'V', 'visit', 'issued',
          v_last_date, v_last_date + 14,
          'Test rounds 2', v_name, lower(replace(v_name, ' ', '.')) || '@example.com',
          'LT' || lpad(i::text, 3, '0') || 'V',
          v_price, 0, v_price, v_tag, md5(random()::text || clock_timestamp()::text || i || 'V'),
          v_last_date::timestamptz + interval '15 hours', lower(replace(v_name, ' ', '.')) || '@example.com'
        );
        INSERT INTO public.invoice_lines (tenant_id, invoice_id, job_id, service_date, description, address, amount, sort_order)
        SELECT v_tenant, v_inv, j.id, j.scheduled_date, j.job_description, j.address, j.quoted_amount, 1
          FROM public.jobs j WHERE j.id = v_last_job;
      END IF;
    END IF;
  END LOOP;

  -- Text conversations: 5 with a reply waiting, 3 already dealt with ----------
  FOR i IN SELECT unnest(ARRAY[2, 7, 13, 22, 31, 4, 9, 17]) LOOP
    SELECT id, name, phone_e164 INTO v_cid, v_name, v_phone
      FROM public.customers WHERE tenant_id = v_tenant AND notes = v_tag || ' #' || i;
    v_first := split_part(v_name, ' ', 1);
    SELECT id, scheduled_date INTO v_next_job, v_next_date
      FROM public.jobs
     WHERE tenant_id = v_tenant AND customer_id = v_cid AND scheduled_date > current_date AND status = 'assigned'
     ORDER BY scheduled_date LIMIT 1;
    CONTINUE WHEN v_next_job IS NULL;

    v_thread := gen_random_uuid();
    INSERT INTO public.message_threads (
      id, tenant_id, customer_id, channel, customer_address, status, needs_attention_reason,
      active_job_ids, last_inbound_at, last_outbound_at, unread_count
    ) VALUES (
      v_thread, v_tenant, v_cid, 'sms', v_phone,
      CASE WHEN i IN (2, 7, 13, 22, 31) THEN 'needs_attention' ELSE 'open' END,
      CASE WHEN i IN (2, 7, 13, 22, 31) THEN 'reply to review' END,
      ARRAY[v_next_job],
      now() - interval '3 hours', now() - interval '1 day',
      CASE WHEN i IN (2, 7, 13, 22, 31) THEN 1 ELSE 0 END
    );
    INSERT INTO public.messages (
      tenant_id, thread_id, customer_id, direction, channel, kind, body, to_address, job_id, job_ids,
      dedupe_key, status, segments, billed_from, sent_at, delivered_at
    ) VALUES (
      v_tenant, v_thread, v_cid, 'outbound', 'sms', 'reminder',
      'Hi ' || v_first || ', your window clean is booked for ' || to_char(v_next_date, 'FMDay FMDD FMMonth') || '. Reply here if you need to change it. Test rounds 2',
      v_phone, v_next_job, ARRAY[v_next_job],
      'look-test:' || i || ':reminder', 'delivered', 1, 'allowance',
      now() - interval '1 day', now() - interval '1 day' + interval '1 minute'
    );
    INSERT INTO public.messages (
      tenant_id, thread_id, customer_id, direction, channel, kind, body, from_address, job_id, job_ids,
      dedupe_key, status, classification, classification_confidence, requested_date, handled_at, handled_action
    ) VALUES (
      v_tenant, v_thread, v_cid, 'inbound', 'sms', 'inbound',
      CASE i
        WHEN 2  THEN 'Can you come Thursday instead? I''m away on the day.'
        WHEN 7  THEN 'Is it ok to skip this time? Thanks'
        WHEN 13 THEN 'Do you do gutters as well?'
        WHEN 22 THEN 'Please can we move it to next week'
        WHEN 31 THEN 'Gate will be locked, key is under the blue pot'
        WHEN 4  THEN 'Thanks, see you then'
        WHEN 9  THEN 'Great, thank you'
        ELSE 'No problem'
      END,
      v_phone, v_next_job, ARRAY[v_next_job],
      'look-test:' || i || ':reply', 'received',
      CASE i WHEN 2 THEN 'asked_move' WHEN 7 THEN 'said_no' WHEN 13 THEN 'question' WHEN 22 THEN 'asked_move' WHEN 31 THEN 'other' ELSE 'other' END,
      0.9,
      CASE WHEN i IN (2, 22) THEN v_next_date + 2 END,
      CASE WHEN i IN (2, 7, 13, 22, 31) THEN NULL ELSE now() - interval '2 hours' END,
      CASE WHEN i IN (2, 7, 13, 22, 31) THEN NULL ELSE 'dismissed' END
    );
    -- The visit shows the reply too ("Needs you" on the overview counts these).
    IF i IN (2, 7, 13, 22, 31) THEN
      UPDATE public.jobs
         SET customer_confirmation_status = CASE i WHEN 7 THEN 'declined' WHEN 2 THEN 'rescheduled' WHEN 22 THEN 'rescheduled' ELSE 'replied' END,
             customer_requested_date = CASE WHEN i IN (2, 22) THEN v_next_date + 2 END,
             customer_reply_at = now() - interval '3 hours'
       WHERE id = v_next_job;
    END IF;
  END LOOP;

  -- Expenses: 15 across seven categories, spread over ten weeks ---------------
  INSERT INTO public.expenses (tenant_id, status, spent_on, merchant, category, amount, vat_amount, note, source, confirmed_at)
  SELECT v_tenant, 'confirmed', current_date - e.days, e.merchant, e.category, e.amount, e.vat, v_tag, 'manual', now()
    FROM (VALUES
      (2,  'Shell Didsbury',      'vehicle',     48.60, 8.10),
      (5,  'Unger Professional',  'equipment',   64.99, 10.83),
      (9,  'Screwfix',            'supplies',    23.40, 3.90),
      (12, 'EE',                  'phone',       28.00, 4.67),
      (16, 'Shell Didsbury',      'vehicle',     52.10, 8.68),
      (20, 'Facebook Ads',        'advertising', 35.00, NULL),
      (24, 'Hiscox',              'insurance',   41.50, NULL),
      (28, 'Unger Professional',  'supplies',    31.80, 5.30),
      (33, 'Shell Didsbury',      'vehicle',     46.90, 7.82),
      (38, 'EE',                  'phone',       28.00, 4.67),
      (43, 'Stripe fees',         'fees',         9.45, NULL),
      (47, 'Screwfix',            'equipment',   37.20, 6.20),
      (52, 'Vistaprint',          'advertising', 54.00, 9.00),
      (58, 'Shell Didsbury',      'vehicle',     50.25, 8.38),
      (66, 'Hiscox',              'insurance',   41.50, NULL)
    ) AS e(days, merchant, category, amount, vat);

  -- Lite: leads and conversations, only if a widget is already set up ---------
  SELECT id INTO v_client FROM public.widget_clients WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;
  IF v_client IS NULL THEN
    RAISE NOTICE 'No widget set up for this business, so leads and conversations were skipped.';
  ELSE
    FOR i IN 1..12 LOOP
      v_conv := gen_random_uuid();
      v_convs := v_convs || v_conv;
      INSERT INTO public.widget_conversations (
        id, client_id, tenant_id, messages, status, created_at, last_message_at, ended_at,
        visitor_message_count, summary, tags
      ) VALUES (
        v_conv, v_client, v_tenant,
        jsonb_build_array(
          jsonb_build_object('role', 'assistant', 'content', 'Hi! What type of job do you need help with today?', 'at', (now() - i * interval '1 day')::text),
          jsonb_build_object('role', 'user', 'content',
            (ARRAY['Can you do the windows on a 3 bed semi?','How much for gutters and fascias?','Do you cover Stockport?','Looking for a regular clean, every four weeks',
                   'Conservatory roof clean, how much?','Are you insured?','Need a one-off clean before a house sale','Price for a bungalow, front and back?',
                   'Do you do commercial?','Can you come this week?','Quote for a shop front please','Windows and a patio clean?'])[i],
            'at', (now() - i * interval '1 day')::text)
        ),
        'ended', now() - i * interval '1 day', now() - i * interval '1 day' + interval '4 minutes',
        now() - i * interval '1 day' + interval '9 minutes', 3,
        v_tag || ' ' || (ARRAY['Asked about a 3 bed semi','Gutters and fascias','Asked about the Stockport area','Regular four-weekly clean',
                                'Conservatory roof','Asked about insurance','Pre-sale clean','Bungalow front and back',
                                'Commercial enquiry','Wants someone this week','Shop front quote','Windows and patio'])[i],
        ARRAY['quote']
      );
    END LOOP;

    INSERT INTO public.leads (
      tenant_id, source, name, phone, phone_e164, email, job_description, quote_given, status, notes,
      widget_conversation_id, client_id, postcode, job_summary, quote_kind, quote_amount, booking_status,
      agreed_amount, decided_at, decided_by, booked_for_date, booked_for_time, status_changed_at, created_at
    )
    SELECT v_tenant, 'chatbot', l.name, '07700 900' || lpad((60 + l.n)::text, 3, '0'), '+447700900' || lpad((60 + l.n)::text, 3, '0'),
           NULL, l.job, l.quote_text, l.status, v_tag, v_convs[l.n], v_client, l.pc, l.job, 'firm', l.amount, l.booking,
           CASE WHEN l.booking = 'accepted' THEN l.amount END,
           CASE WHEN l.booking IN ('accepted', 'declined') THEN now() - interval '1 day' END,
           CASE WHEN l.booking IN ('accepted', 'declined') THEN 'owner' END,
           l.booked, CASE WHEN l.booked IS NOT NULL THEN time '10:00' END,
           now() - l.n * interval '1 day', now() - l.n * interval '1 day'
      FROM (VALUES
        (1, 'Gemma Holt',     'Windows on a 3 bed semi',          '£25',  25, 'new',       'requested', NULL::date,         'M20 3QR'),
        (2, 'Neil Barker',    'Gutters and fascias, detached',    '£90',  90, 'new',       'requested', NULL,               'M14 6TT'),
        (3, 'Aisha Rahman',   'Conservatory roof clean',          '£60',  60, 'new',       'none',      NULL,               'M20 4HP'),
        (4, 'Phil Dawson',    'Four-weekly window clean',         '£18',  18, 'contacted', 'none',      NULL,               'M20 6BN'),
        (5, 'Claire Bowman',  'One-off clean before a sale',      '£70',  70, 'contacted', 'none',      NULL,               'M14 5LA'),
        (6, 'Tom Ridley',     'Bungalow, front and back',         '£22',  22, 'won',       'accepted',  current_date + 3,   'M20 2DE'),
        (7, 'Sunita Gill',    'Windows and patio',                '£55',  55, 'won',       'accepted',  current_date + 6,   'M20 1FG'),
        (8, 'Doug Henshaw',   'Shop front, weekly',               '£35',  35, 'lost',      'declined',  NULL,               'M14 7WK')
      ) AS l(n, name, job, quote_text, amount, status, booking, booked, pc);
  END IF;

  RAISE NOTICE 'Look-test data added for Test rounds 2. Remove it with look-test-rounds2-remove.sql.';
END $$;
