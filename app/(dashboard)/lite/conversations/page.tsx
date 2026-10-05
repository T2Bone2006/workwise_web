import Link from 'next/link';
import { CalendarDays, MapPinOff, MessagesSquare } from 'lucide-react';
import { EmptyState, StatTile } from '@/components/look';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { ConversationFilters } from '@/components/lite/conversations/conversation-filters';
import { ConversationRow } from '@/components/lite/conversations/conversation-row';
import { SetupBanner } from '@/components/lite/setup-banner';
import { listConversations, normaliseConversationQuery } from '@/lib/data/lite/conversations';
import { getSetupStatus } from '@/lib/lite/setup-status';
import { requireLite } from '@/lib/lite/require-lite';
import { litePaths } from '@/lib/navigation/lite-paths';
import { createAdminClient } from '@/lib/supabase/admin';
import { Button } from '@/components/ui/button';

function listHref(filter: string, page: number): string {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('filter', filter);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `${litePaths.conversations}?${query}` : litePaths.conversations;
}

export default async function LiteConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const auth = await requireLite();
  if (!auth.ok) {
    return (
      <div className="flex flex-col gap-4">
        <PageGradientHeader title="Conversations" subtitle="Every chat on your website, summed up in a line." />
        <p className="text-sm text-muted-foreground">{auth.error}</p>
      </div>
    );
  }

  const params = await searchParams;
  const query = normaliseConversationQuery({ filter: params.filter, page: params.page });
  const [data, setup] = await Promise.all([
    listConversations(auth.ctx.tenantId, query),
    getSetupStatus(createAdminClient(), auth.ctx.tenantId).catch(() => null),
  ]);
  const empty = data.items.length === 0;
  const settingUp = setup?.state === 'in_progress';

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageGradientHeader title="Conversations" subtitle="Every chat on your website, summed up in a line." />
      {setup?.state === 'in_progress' ? <SetupBanner stage={setup.stage} /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="This week"
          value={String(data.counts.thisWeek)}
          sub={`${data.counts.leftDetailsThisWeek} left their details`}
          tone="lite"
          icon={MessagesSquare}
        />
        <StatTile label="This month" value={String(data.counts.thisMonth)} sub="chats" tone="rounds" icon={CalendarDays} />
        <StatTile
          label="Out of area this month"
          value={String(data.counts.outOfAreaThisMonth)}
          sub="chats from outside the areas you cover"
          tone="amber"
          icon={MapPinOff}
        />
      </div>
      <ConversationFilters filter={query.filter} />
      {empty ? (
        query.filter === 'all' ? (
          <EmptyState
            icon={MessagesSquare}
            title="No chats yet"
            body={
              settingUp
                ? 'Chats show up here after you finish setting up and the assistant is on your website. Each one is summed up in a line.'
                : 'Once the assistant is on your website, every chat shows up here, summed up in a line.'
            }
            action={
              settingUp ? undefined : (
                <Button asChild>
                  <Link href={litePaths.widget}>Try the chat</Link>
                </Button>
              )
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground">No chats in this filter.</p>
        )
      ) : (
        <ol className="flex min-w-0 flex-col gap-2.5">
          {data.items.map((item) => (
            <ConversationRow key={item.id} item={item} />
          ))}
        </ol>
      )}
      {data.pageCount > 1 ? (
        <nav aria-label="Pages" className="flex flex-wrap items-center gap-4 text-sm">
          {data.page > 1 ? (
            <Link href={listHref(query.filter, data.page - 1)} className="font-semibold">
              Newer
            </Link>
          ) : (
            <span className="text-muted-foreground">Newer</span>
          )}
          <span className="text-muted-foreground">
            Page {data.page} of {data.pageCount}
          </span>
          {data.page < data.pageCount ? (
            <Link href={listHref(query.filter, data.page + 1)} className="font-semibold">
              Older
            </Link>
          ) : (
            <span className="text-muted-foreground">Older</span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
