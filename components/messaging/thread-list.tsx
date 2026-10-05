'use client';

import { useState, type JSX } from 'react';
import Link from 'next/link';
import { CalendarDays, MessageSquare, Search, SearchX, X } from 'lucide-react';
import { JobsDateRangeFilter } from '@/components/jobs/jobs-date-range-filter';
import { Avatar, EmptyState, Tag, type Tone } from '@/components/look';
import { Input } from '@/components/ui/input';
import type { ThreadListItem } from '@/lib/data/messaging/threads';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd } from '@/lib/rounds/dates';
import { cn } from '@/lib/utils';

type GroupKey = 'cancel' | 'reschedule' | 'message' | 'sent';
type PillKey = 'all' | 'needs' | GroupKey;

/** What each kind of conversation is called and coloured, here and on the phone. */
const TOPICS: Record<GroupKey, { title: string; tone: Tone }> = {
  cancel: { title: 'Cancel', tone: 'rose' },
  reschedule: { title: 'Reschedule', tone: 'amber' },
  message: { title: 'A message', tone: 'rounds' },
  sent: { title: 'Sent', tone: 'slate' },
};

const HANDLED_LABEL = {
  skipped: 'Skipped',
  moved: 'Moved',
  kept: 'Kept',
  dismissed: 'Dismissed',
} as const;

function needsChoice(item: ThreadListItem): boolean {
  return item.status === 'needs_attention' && !item.handled;
}

function groupKey(item: ThreadListItem): GroupKey {
  if (item.topic === 'said_no') return 'cancel';
  if (item.topic === 'asked_move') return 'reschedule';
  if (item.topic === 'replied') return 'message';
  return 'sent';
}

function londonParts(iso: string): { ymd: string; time: string; weekday: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    weekday: get('weekday'),
  };
}

/** "14:02" today, "Yesterday", "Mon" this week, then "12 Oct". */
function shortWhen(iso: string | null): string | null {
  if (!iso) return null;
  const then = londonParts(iso);
  const now = londonParts(new Date().toISOString());
  if (!then || !now) return null;
  if (then.ymd === now.ymd) return then.time;
  const dayMs = 86_400_000;
  const days = Math.round((Date.parse(`${now.ymd}T00:00:00Z`) - Date.parse(`${then.ymd}T00:00:00Z`)) / dayMs);
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return then.weekday;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${then.ymd}T00:00:00Z`),
  );
}

function dayWords(ymd: string | null): string | null {
  return ymd && isValidYmd(ymd) ? formatVisitDay(ymd) : null;
}

/** The one-line label under a conversation: what they said, or what you chose. */
function rowTag(item: ThreadListItem): { tone: Tone; text: string } | null {
  if (item.handled) return { tone: 'slate', text: HANDLED_LABEL[item.handled] };
  const label = item.label;
  if (!label) return null;
  if (label.kind === 'said_no') {
    const visit = dayWords(label.visitDate);
    return { tone: 'rose', text: visit ? `Said no · ${visit}` : 'Said no' };
  }
  if (label.kind === 'asked_move') {
    const asked = dayWords(label.requestedDate);
    return { tone: 'amber', text: asked ? `Asked for ${asked}` : 'Asked to move' };
  }
  return { tone: 'rounds', text: 'Sent a message' };
}

export function ThreadList(props: {
  items: ThreadListItem[];
  activeId: string | null;
  emptyText: string;
}): JSX.Element {
  const { items, activeId, emptyText } = props;
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [showDates, setShowDates] = useState(false);
  const [pill, setPill] = useState<PillKey>('all');

  const needle = search.trim().toLowerCase();
  const hasFilters = needle.length > 0 || Boolean(dateFrom || dateTo) || pill !== 'all';

  const filtered = items.filter((item) => {
    if (needle) {
      const haystack = [item.customerName, item.preview].join(' ').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    const day = item.lastAt ? (londonParts(item.lastAt)?.ymd ?? '') : '';
    if (dateFrom && (!day || day < dateFrom)) return false;
    if (dateTo && (!day || day > dateTo)) return false;
    if (pill === 'needs' && !needsChoice(item)) return false;
    if (pill !== 'all' && pill !== 'needs' && groupKey(item) !== pill) return false;
    return true;
  });

  const waiting = filtered.filter(needsChoice);
  const rest = filtered.filter((item) => !needsChoice(item));
  const needsCount = items.filter(needsChoice).length;
  const pills: { key: PillKey; label: string; count: number; tone?: Tone }[] = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'needs', label: 'Needs you', count: needsCount, tone: 'amber' },
    ...(['cancel', 'reschedule', 'message', 'sent'] as GroupKey[]).map((key) => ({
      key,
      label: TOPICS[key].title,
      tone: TOPICS[key].tone,
      count: items.filter((item) => groupKey(item) === key).length,
    })),
  ];

  return (
    <section
      aria-label="Conversations"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-(--look-card-shadow) lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto"
    >
      <div className="sticky top-0 z-10 space-y-2.5 border-b border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Customer or message…"
              aria-label="Search conversations"
              className="pr-9 pl-9"
            />
            {search.length > 0 ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setShowDates((value) => !value)}
            aria-pressed={showDates || Boolean(dateFrom || dateTo)}
            aria-label="Filter by date"
            title="Filter by date"
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg border border-input bg-card text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              (showDates || dateFrom || dateTo) && 'border-primary text-primary',
            )}
          >
            <CalendarDays className="size-4" />
          </button>
        </div>
        {showDates || dateFrom || dateTo ? (
          <JobsDateRangeFilter
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={({ date_from, date_to }) => {
              setDateFrom(date_from);
              setDateTo(date_to);
            }}
          />
        ) : null}
        <div
          role="group"
          aria-label="Kind of conversation"
          className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {pills.map((item) => {
            const active = pill === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => setPill(active && item.key !== 'all' ? 'all' : item.key)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  active
                    ? 'border-primary bg-(--tone-rounds-soft) text-(--tone-rounds-text)'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {item.label}
                <span className={cn('tabular-nums', item.key === 'needs' && item.count > 0 && !active && 'text-(--tone-amber-text)')}>
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>
        {hasFilters ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setDateFrom(undefined);
              setDateTo(undefined);
              setShowDates(false);
              setPill('all');
            }}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="p-3">
          <EmptyState
            icon={MessageSquare}
            title={emptyText}
            body="Replies from customers land here, and so do the texts WorkWise sends for you."
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-3">
          <EmptyState icon={SearchX} title="Nothing matches" body="Try a different name or clear the filters." />
        </div>
      ) : (
        <div>
          {waiting.length > 0 ? (
            <div className="bg-(--tone-amber-soft)">
              <h2 className="flex items-center gap-2 px-4 pt-3 pb-1 text-[13px] font-semibold">
                Needs you
                <Tag tone="amber" className="tabular-nums">
                  {waiting.length}
                </Tag>
              </h2>
              <ul className="px-1.5 pb-1.5">
                {waiting.map((item) => (
                  <ThreadRow key={item.id} item={item} active={item.id === activeId} />
                ))}
              </ul>
            </div>
          ) : null}
          {rest.length > 0 ? (
            <div>
              {waiting.length > 0 ? (
                <h2 className="px-4 pt-3 pb-1 text-[13px] font-semibold text-muted-foreground">Everything else</h2>
              ) : null}
              <ul className="px-1.5 py-1.5">
                {rest.map((item) => (
                  <ThreadRow key={item.id} item={item} active={item.id === activeId} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ThreadRow({ item, active }: { item: ThreadListItem; active: boolean }) {
  const topic = TOPICS[groupKey(item)];
  const unseen = item.unread > 0;
  const when = shortWhen(item.lastAt);
  const preview =
    item.previewDirection === 'outbound' && item.preview ? `You: ${item.preview}` : item.preview;
  const tag = rowTag(item);
  const sample = item.id.startsWith('sample-');

  return (
    <li className="list-none">
      <Link
        href={sample ? '#' : `/messages/${item.id}`}
        onClick={sample ? (event) => event.preventDefault() : undefined}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-start gap-3 rounded-xl px-2.5 py-2.5 transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
          active ? 'bg-(--tone-rounds-soft)' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]',
        )}
      >
        <Avatar
          name={item.customerName}
          tone={topic.tone}
          className={needsChoice(item) ? 'bg-card ring-1 ring-(--tone-amber-line)' : undefined}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-[15px] tracking-tight', unseen ? 'font-semibold' : 'font-medium')}>
              {item.customerName}
            </span>
            {when ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{when}</span> : null}
          </span>
          {preview ? (
            <span className={cn('mt-0.5 block truncate text-[13px]', unseen ? 'text-foreground' : 'text-muted-foreground')}>
              {preview}
            </span>
          ) : null}
          {tag || unseen ? (
            <span className="mt-1.5 flex items-center gap-2">
              {tag ? <Tag tone={tag.tone}>{tag.text}</Tag> : null}
              {unseen ? (
                <span className="size-2 rounded-full bg-(--tone-rose-solid)" role="img" aria-label="New" />
              ) : null}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
