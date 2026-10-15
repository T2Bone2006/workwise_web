import type { ThreadListItem } from '@/lib/data/messaging/threads';

/** Made-up conversations for /messages?preview=1, so every colour and state can be seen. Not real messages. */
export function sampleThreads(): ThreadListItem[] {
  const now = new Date().toISOString();
  const row = (
    id: string,
    name: string,
    patch: Partial<ThreadListItem>,
  ): ThreadListItem => ({
    id: `sample-${id}`,
    customerId: 'sample',
    customerName: name,
    status: 'open',
    reason: null,
    unread: 0,
    lastAt: now,
    preview: '',
    previewDirection: 'inbound',
    label: null,
    handled: null,
    topic: null,
    ...patch,
  });

  return [
    row('cancel-new', 'Cancel — new', {
      status: 'needs_attention',
      unread: 1,
      topic: 'said_no',
      preview: "No, I can't do Thursday",
      label: { kind: 'said_no', visitDate: '2026-10-02', requestedDate: null },
    }),
    row('cancel-waiting', 'Cancel — needs a choice', {
      status: 'needs_attention',
      topic: 'said_no',
      preview: "No, I can't do Thursday",
      label: { kind: 'said_no', visitDate: '2026-10-02', requestedDate: null },
    }),
    row('cancel-handled', 'Cancel — handled', {
      topic: 'said_no',
      handled: 'skipped',
      preview: "No, I can't do Thursday",
    }),
    row('move-new', 'Reschedule — new', {
      status: 'needs_attention',
      unread: 1,
      topic: 'asked_move',
      preview: 'Can you come Friday instead?',
      label: { kind: 'asked_move', visitDate: '2026-10-02', requestedDate: '2026-10-03' },
    }),
    row('move-waiting', 'Reschedule — needs a choice', {
      status: 'needs_attention',
      topic: 'asked_move',
      preview: 'Can you come Friday instead?',
      label: { kind: 'asked_move', visitDate: '2026-10-02', requestedDate: '2026-10-03' },
    }),
    row('move-handled', 'Reschedule — handled', {
      topic: 'asked_move',
      handled: 'moved',
      preview: 'Can you come Friday instead?',
    }),
    row('message-new', 'Message — new', {
      status: 'needs_attention',
      unread: 1,
      topic: 'replied',
      preview: 'What time will you get here?',
      label: { kind: 'replied', visitDate: '2026-10-02', requestedDate: null },
    }),
    row('message-waiting', 'Message — needs a choice', {
      status: 'needs_attention',
      topic: 'replied',
      preview: 'What time will you get here?',
      label: { kind: 'replied', visitDate: '2026-10-02', requestedDate: null },
    }),
    row('message-kept', 'Message — kept', {
      topic: 'replied',
      handled: 'kept',
      preview: 'What time will you get here?',
    }),
    row('message-done', 'Message — dismissed', {
      topic: 'replied',
      handled: 'dismissed',
      preview: 'Thanks, see you then',
    }),
    row('sent', 'Sent', {
      previewDirection: 'outbound',
      preview: 'Reminder: we are due Thu 2 Oct',
    }),
    row('sent-new', 'Sent — new', {
      unread: 1,
      previewDirection: 'outbound',
      preview: 'Reminder: we are due Thu 2 Oct',
    }),
  ];
}
