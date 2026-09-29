import { redirect } from 'next/navigation';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { TextsMeter } from '@/components/messaging/texts-meter';
import { ThreadList } from '@/components/messaging/thread-list';
import { getTextUsage, type TextUsage } from '@/lib/data/messaging/texts';
import { getThreads, type ThreadListItem } from '@/lib/data/messaging/threads';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { createClient } from '@/lib/supabase/server';

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId) redirect('/login');
  if (!products.hasRounds) redirect('/dashboard');

  const preview = (await searchParams).preview === '1';
  const supabase = await createClient();

  let usage: TextUsage | null = null;
  let usageError: string | null = null;
  const [threads, usageResult] = await Promise.all([
    preview ? Promise.resolve(sampleThreads()) : getThreads(supabase, tenantId, { filter: 'all' }),
    getTextUsage(supabase, tenantId).then(
      (value) => ({ usage: value, error: null as string | null }),
      (error: unknown) => ({
        usage: null,
        error: error instanceof Error ? error.message : 'Could not load texts',
      }),
    ),
  ]);
  usage = usageResult.usage;
  usageError = usageResult.error;

  const emptyText = 'No texts yet.';

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Messages"
        subtitle="Replies that need a choice, and the texts you've sent."
      />
      {usage ? <TextsMeter usage={usage} /> : null}
      {usageError ? <p className="text-sm text-destructive">{usageError}</p> : null}
      {preview ? (
        <p className="text-sm text-muted-foreground">
          Samples only, so you can see every colour and state. They are not real messages.
        </p>
      ) : null}
      <ThreadList items={threads} emptyText={emptyText} />
    </div>
  );
}

function sampleThreads(): ThreadListItem[] {
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
