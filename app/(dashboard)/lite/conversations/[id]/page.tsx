import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConversationTranscript, londonWhen } from '@/components/lite/conversation-transcript';
import { getConversation } from '@/lib/data/lite/conversations';
import { requireLite } from '@/lib/lite/require-lite';
import { litePaths } from '@/lib/navigation/lite-paths';
import { cn } from '@/lib/utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_LABEL = { new: 'New', contacted: 'Contacted', won: 'Won', lost: 'Lost' } as const;

const STATUS_TONE = {
  new: 'text-sky-800 dark:text-sky-200',
  contacted: 'text-indigo-800 dark:text-indigo-200',
  won: 'text-emerald-800 dark:text-emerald-200',
  lost: 'text-slate-600 dark:text-slate-300',
} as const;

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const auth = await requireLite();
  if (!auth.ok) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{auth.error}</p>
        <Link href={litePaths.conversations} className="text-sm font-medium">
          Conversations
        </Link>
      </div>
    );
  }

  const chat = await getConversation(auth.ctx.tenantId, id);
  if (!chat) notFound();
  const when = londonWhen(chat.startedAt);
  const count = chat.messages.length;
  const heading = when
    ? `${when.dayMonth}, ${when.hm} · ${count} ${count === 1 ? 'message' : 'messages'}`
    : `${count} ${count === 1 ? 'message' : 'messages'}`;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="min-w-0">
        <Link href={litePaths.conversations} className="text-sm font-medium text-muted-foreground">
          Conversations
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{heading}</h1>
        {chat.lead ? (
          <Link href={litePaths.lead(chat.lead.id)} className={cn('mt-2 inline-block text-sm font-medium', STATUS_TONE[chat.lead.status])}>
            {chat.lead.firstName} · {STATUS_LABEL[chat.lead.status]}
          </Link>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No details left</p>
        )}
      </header>
      <ConversationTranscript summary={chat.summary} tags={chat.tags} messages={chat.messages} status={chat.status} />
    </div>
  );
}
