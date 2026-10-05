-- Patch for look-test-rounds2.sql (already pasted): marks the next visit of each
-- customer whose reply is waiting, so "Needs you" on the overview shows
-- "customer replies to read". Only touches visits linked to [look-test] replies
-- on "Test rounds 2". Safe to run more than once. Sends nothing.
UPDATE public.jobs j
   SET customer_confirmation_status = CASE m.classification
         WHEN 'said_no' THEN 'declined'
         WHEN 'asked_move' THEN 'rescheduled'
         ELSE 'replied' END,
       customer_requested_date = m.requested_date,
       customer_reply_at = now() - interval '3 hours'
  FROM public.messages m
 WHERE m.tenant_id = 'f571681c-3054-4836-8086-11c1777fc4ea'
   AND j.tenant_id = m.tenant_id
   AND m.dedupe_key LIKE 'look-test:%:reply'
   AND m.handled_at IS NULL
   AND j.id = m.job_id;
