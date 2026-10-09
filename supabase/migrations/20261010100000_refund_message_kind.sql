-- messages.kind: + 'refund' (the "your refund is on its way" message sent when a trader refunds in WorkWise)

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_kind_check CHECK (kind IN (
    'reminder', 'visit_done', 'chaser', 'payment_received', 'visit_change', 'reply_ack', 'inbound',
    'dd_invite', 'dd_failed', 'refund'
  ));
