-- Demo seed for Rounds tenant "Test rounds 2"
-- tenant: f571681c-3054-4836-8086-11c1777fc4ea
-- worker: 09c51516-ea52-4bdf-9980-c002429f615e (test4@gmail.com)
--
-- Idempotent: removes previous phase1-demo-seed rows, then inserts a small
-- round for this week (Wed–Fri) plus the following Wednesday for calendar density.
-- Safe to re-run.

DO $$
DECLARE
  v_tenant uuid := 'f571681c-3054-4836-8086-11c1777fc4ea';
  v_worker uuid := '09c51516-ea52-4bdf-9980-c002429f615e';
  v_svc_front uuid := '4192542a-fb07-4810-82d6-2b65b028ce77';
  v_svc_both uuid := '1e073d2f-8926-499c-8ffe-223fea3b012d';
  v_svc_gutter uuid := '7134f03e-a210-44b2-a127-39bd89bee314';

  c1 uuid := 'a1000001-0001-4000-8000-000000000001';
  c2 uuid := 'a1000001-0001-4000-8000-000000000002';
  c3 uuid := 'a1000001-0001-4000-8000-000000000003';
  c4 uuid := 'a1000001-0001-4000-8000-000000000004';
  c5 uuid := 'a1000001-0001-4000-8000-000000000005';
  c6 uuid := 'a1000001-0001-4000-8000-000000000006';
  c7 uuid := 'a1000001-0001-4000-8000-000000000007';
  c8 uuid := 'a1000001-0001-4000-8000-000000000008';

  a1 uuid := 'a2000001-0001-4000-8000-000000000001';
  a2 uuid := 'a2000001-0001-4000-8000-000000000002';
  a3 uuid := 'a2000001-0001-4000-8000-000000000003';
  a4 uuid := 'a2000001-0001-4000-8000-000000000004';
  a5 uuid := 'a2000001-0001-4000-8000-000000000005';
  a6 uuid := 'a2000001-0001-4000-8000-000000000006';
  a7 uuid := 'a2000001-0001-4000-8000-000000000007';
  a8 uuid := 'a2000001-0001-4000-8000-000000000008';
  a9 uuid := 'a2000001-0001-4000-8000-000000000009';
BEGIN
  -- Wipe previous demo visits/agreements/customers (by fixed ids)
  DELETE FROM public.jobs
  WHERE tenant_id = v_tenant
    AND service_agreement_id IN (a1, a2, a3, a4, a5, a6, a7, a8, a9);

  DELETE FROM public.service_agreements
  WHERE tenant_id = v_tenant
    AND id IN (a1, a2, a3, a4, a5, a6, a7, a8, a9);

  DELETE FROM public.customers
  WHERE tenant_id = v_tenant
    AND id IN (c1, c2, c3, c4, c5, c6, c7, c8);

  INSERT INTO public.customers (
    id, tenant_id, name, type, phone, phone_e164, email, notes,
    payment_terms, preferred_channel, access_notes, is_active
  ) VALUES
    (c1, v_tenant, 'Mrs Patel', 'individual', '07700 900111', '+447700900111',
     'patel@example.com', 'phase1-demo-seed', 'on_the_day', 'whatsapp',
     'Side gate — dog friendly', true),
    (c2, v_tenant, 'James O''Connor', 'individual', '07700 900222', '+447700900222',
     NULL, 'phase1-demo-seed', 'on_the_day', 'sms',
     'Park on the drive', true),
    (c3, v_tenant, 'Helen Wright', 'individual', '07700 900333', '+447700900333',
     'helen.wright@example.com', 'phase1-demo-seed', 'on_the_day', 'whatsapp',
     NULL, true),
    (c4, v_tenant, 'The Oak Tree Cafe', 'individual', '0161 000 4444', '+441610004444',
     'oaks@example.com', 'phase1-demo-seed', 'monthly_invoice', 'email',
     'Ask for manager if closed', true),
    (c5, v_tenant, 'David Chen', 'individual', '07700 900555', '+447700900555',
     NULL, 'phase1-demo-seed', 'on_the_day', 'sms',
     'Buzzer #12', true),
    (c6, v_tenant, 'Sarah Mitchell', 'individual', '07700 900666', '+447700900666',
     'sarah.m@example.com', 'phase1-demo-seed', 'on_the_day', 'whatsapp',
     'Conservatory at rear', true),
    (c7, v_tenant, 'Priya Shah', 'individual', '07700 900777', '+447700900777',
     NULL, 'phase1-demo-seed', 'on_the_day', 'sms',
     NULL, true),
    (c8, v_tenant, 'Tom Bradley', 'individual', '07700 900888', '+447700900888',
     'tom.bradley@example.com', 'phase1-demo-seed', 'on_the_day', 'whatsapp',
     'Keys with neighbour at 14', true);

  -- Agreements: mostly fixed Fridays/Wednesdays; one after_completion
  -- preferred_weekday: 1=Mon … 3=Wed … 5=Fri
  INSERT INTO public.service_agreements (
    id, tenant_id, customer_id, service_catalog_id, title,
    address, postcode, lat, lng, price, duration_minutes, frequency_days,
    anchor_date, preferred_weekday, preferred_time, schedule_mode,
    next_due_date, status, assigned_worker_id, reminder_enabled, access_notes, notes
  ) VALUES
    -- Wed 23 stops
    (a1, v_tenant, c1, v_svc_both, 'Window clean (front & back)',
     '12 Elm Road', 'M20 2AB', 53.4241, -2.2405, 18.00, 30, 28,
     '2026-09-23', 3, '09:00', 'fixed',
     '2026-10-21', 'active', v_worker, true, 'Side gate — dog friendly', 'phase1-demo-seed'),
    (a2, v_tenant, c2, v_svc_front, 'Window clean (front)',
     '4 Beech Avenue', 'M20 3CD', 53.4260, -2.2380, 12.00, 20, 28,
     '2026-09-23', 3, '09:30', 'fixed',
     '2026-10-21', 'active', v_worker, true, 'Park on the drive', 'phase1-demo-seed'),
    (a3, v_tenant, c3, v_svc_both, 'Window clean (front & back)',
     '27 Maple Close', 'M14 4EF', 53.4402, -2.2281, 18.00, 30, 28,
     '2026-09-23', 3, '10:00', 'fixed',
     '2026-10-21', 'active', v_worker, true, NULL, 'phase1-demo-seed'),
    (a4, v_tenant, c4, v_svc_front, 'Window clean (front)',
     '1 High Street', 'M20 1GH', 53.4225, -2.2450, 12.00, 20, 14,
     '2026-09-23', 3, '10:30', 'fixed',
     '2026-10-07', 'active', v_worker, true, 'Ask for manager if closed', 'phase1-demo-seed'),
    (a5, v_tenant, c5, v_svc_both, 'Window clean (front & back)',
     '88 Victoria Road', 'M14 5IJ', 53.4388, -2.2310, 18.00, 30, 28,
     '2026-09-23', 3, '11:00', 'fixed',
     '2026-10-21', 'active', v_worker, true, 'Buzzer #12', 'phase1-demo-seed'),
    -- Thu 24
    (a6, v_tenant, c6, v_svc_both, 'Window clean (front & back)',
     '15 Willow Lane', 'M20 4KL', 53.4255, -2.2365, 18.00, 30, 28,
     '2026-09-24', 4, '09:00', 'fixed',
     '2026-10-22', 'active', v_worker, true, 'Conservatory at rear', 'phase1-demo-seed'),
    (a7, v_tenant, c7, v_svc_front, 'Window clean (front)',
     '3 Cedar Court', 'M14 6MN', 53.4410, -2.2250, 12.00, 20, 28,
     '2026-09-24', 4, '09:45', 'fixed',
     '2026-10-22', 'active', v_worker, true, NULL, 'phase1-demo-seed'),
    -- Fri 25 + gutter (longer)
    (a8, v_tenant, c8, v_svc_gutter, 'Gutter clear',
     '9 Ash Grove', 'M20 5OP', 53.4230, -2.2420, 60.00, 60, 365,
     '2026-09-25', 5, '09:00', 'fixed',
     '2027-09-24', 'active', v_worker, true, 'Keys with neighbour at 14', 'phase1-demo-seed'),
    -- after_completion: one outstanding visit on Wed
    (a9, v_tenant, c3, v_svc_front, 'Window clean (front) — fortnightly after last done',
     '27 Maple Close (garage)', 'M14 4EF', 53.4403, -2.2282, 12.00, 20, 14,
     '2026-09-23', NULL, '14:00', 'after_completion',
     '2026-09-23', 'active', v_worker, true, NULL, 'phase1-demo-seed');

  -- Visits this week + next Wed for calendar density
  INSERT INTO public.jobs (
    tenant_id, reference_number, customer_id, assigned_worker_id,
    service_agreement_id, agreement_occurrence_date,
    address, postcode, lat, lng, job_description,
    status, priority, scheduled_date, scheduled_time,
    estimated_duration_minutes, quoted_amount, payment_status,
    route_position, required_skills, industry_data, source_fields, custom_fields,
    completed_at
  ) VALUES
    -- Wed 23 — ordered day (1 done already so home stats look real)
    (v_tenant, 'R-A20001-20260923', c1, v_worker, a1, '2026-09-23',
     '12 Elm Road', 'M20 2AB', 53.4241, -2.2405, 'Window clean (front & back)',
     'completed', 'normal', '2026-09-23', '09:00', 30, 18.00, 'unpaid',
     1, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
     jsonb_build_object('rounds', jsonb_build_object('seed', 'phase1-demo', 'agreement_id', a1)),
     now() - interval '2 hours'),
    (v_tenant, 'R-A20002-20260923', c2, v_worker, a2, '2026-09-23',
     '4 Beech Avenue', 'M20 3CD', 53.4260, -2.2380, 'Window clean (front)',
     'assigned', 'normal', '2026-09-23', '09:30', 20, 12.00, 'unpaid',
     2, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
     jsonb_build_object('rounds', jsonb_build_object('seed', 'phase1-demo', 'agreement_id', a2)),
     NULL),
    (v_tenant, 'R-A20003-20260923', c3, v_worker, a3, '2026-09-23',
     '27 Maple Close', 'M14 4EF', 53.4402, -2.2281, 'Window clean (front & back)',
     'assigned', 'normal', '2026-09-23', '10:00', 30, 18.00, 'unpaid',
     3, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
     jsonb_build_object('rounds', jsonb_build_object('seed', 'phase1-demo', 'agreement_id', a3)),
     NULL),
    (v_tenant, 'R-A20004-20260923', c4, v_worker, a4, '2026-09-23',
     '1 High Street', 'M20 1GH', 53.4225, -2.2450, 'Window clean (front)',
     'assigned', 'normal', '2026-09-23', '10:30', 20, 12.00, 'unpaid',
     4, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
     jsonb_build_object('rounds', jsonb_build_object('seed', 'phase1-demo', 'agreement_id', a4)),
     NULL),
    (v_tenant, 'R-A20005-20260923', c5, v_worker, a5, '2026-09-23',
     '88 Victoria Road', 'M14 5IJ', 53.4388, -2.2310, 'Window clean (front & back)',
     'assigned', 'normal', '2026-09-23', '11:00', 30, 18.00, 'unpaid',
     5, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
     jsonb_build_object('rounds', jsonb_build_object('seed', 'phase1-demo', 'agreement_id', a5)),
     NULL),
    (v_tenant, 'R-A20009-20260923', c3, v_worker, a9, '2026-09-23',
     '27 Maple Close (garage)', 'M14 4EF', 53.4403, -2.2282,
     'Window clean (front) — fortnightly after last done',
     'assigned', 'normal', '2026-09-23', '14:00', 20, 12.00, 'unpaid',
     6, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
     jsonb_build_object('rounds', jsonb_build_object('seed', 'phase1-demo', 'agreement_id', a9)),
     NULL),

    -- Thu 24
    (v_tenant, 'R-A20006-20260924', c6, v_worker, a6, '2026-09-24',
     '15 Willow Lane', 'M20 4KL', 53.4255, -2.2365, 'Window clean (front & back)',
     'assigned', 'normal', '2026-09-24', '09:00', 30, 18.00, 'unpaid',
     1, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
     jsonb_build_object('rounds', jsonb_build_object('seed', 'phase1-demo', 'agreement_id', a6)),
     NULL),
    (v_tenant, 'R-A20007-20260924', c7, v_worker, a7, '2026-09-24',
     '3 Cedar Court', 'M14 6MN', 53.4410, -2.2250, 'Window clean (front)',
     'assigned', 'normal', '2026-09-24', '09:45', 20, 12.00, 'unpaid',
     2, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
     jsonb_build_object('rounds', jsonb_build_object('seed', 'phase1-demo', 'agreement_id', a7)),
     NULL),

    -- Fri 25
    (v_tenant, 'R-A20008-20260925', c8, v_worker, a8, '2026-09-25',
     '9 Ash Grove', 'M20 5OP', 53.4230, -2.2420, 'Gutter clear',
     'assigned', 'normal', '2026-09-25', '09:00', 60, 60.00, 'unpaid',
     1, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
     jsonb_build_object('rounds', jsonb_build_object('seed', 'phase1-demo', 'agreement_id', a8)),
     NULL),
    (v_tenant, 'R-A20004-20260925', c4, v_worker, a4, '2026-10-07',
     '1 High Street', 'M20 1GH', 53.4225, -2.2450, 'Window clean (front)',
     'assigned', 'normal', '2026-09-25', '11:00', 20, 12.00, 'unpaid',
     2, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
     jsonb_build_object('rounds', jsonb_build_object('seed', 'phase1-demo', 'agreement_id', a4)),
     NULL),

    -- Next Wed 30 — calendar month counts
    (v_tenant, 'R-A20002-20260930', c2, v_worker, a2, '2026-10-21',
     '4 Beech Avenue', 'M20 3CD', 53.4260, -2.2380, 'Window clean (front)',
     'assigned', 'normal', '2026-09-30', '09:30', 20, 12.00, 'unpaid',
     NULL, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
     jsonb_build_object('rounds', jsonb_build_object('seed', 'phase1-demo', 'agreement_id', a2)),
     NULL),
    (v_tenant, 'R-A20006-20260930', c6, v_worker, a6, '2026-10-22',
     '15 Willow Lane', 'M20 4KL', 53.4255, -2.2365, 'Window clean (front & back)',
     'assigned', 'normal', '2026-09-30', '10:00', 30, 18.00, 'unpaid',
     NULL, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb,
     jsonb_build_object('rounds', jsonb_build_object('seed', 'phase1-demo', 'agreement_id', a6)),
     NULL);
END $$;
