'use client';

import { useState, type JSX } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  CalendarClock,
  CalendarOff,
  MessageCircle,
  Send,
  type LucideIcon,
} from 'lucide-react';
import {
  SummaryStrip,
  type SummaryStripItem,
} from '@/components/jobs/status-summary-strip';
import {
  PaymentsListFilters,
  type PaymentsFilterField,
  type PaymentsWhere,
} from '@/components/payments/payments-filter-bar';
import type { ThreadListItem } from '@/lib/data/messaging/threads';
import { cn } from '@/lib/utils';

type GroupKey = 'cancel' | 'reschedule' | 'message' | 'sent';

const TOPICS: {
  key: GroupKey;
  title: string;
  icon: LucideIcon;
  bar: string;
  washStrong: string;
  washQuiet: string;
  glow: string;
}[] = [
  {
    key: 'cancel',
    title: 'Cancel',
    icon: CalendarOff,
    bar: 'bg-rose-500',
    washStrong: 'from-rose-500/25 via-rose-500/5 to-transparent dark:from-rose-400/30',
    washQuiet: 'from-rose-500/[0.08] via-transparent to-transparent dark:from-rose-400/15',
    glow: 'rgb(244 63 94)',
  },
  {
    key: 'reschedule',
    title: 'Reschedule',
    icon: CalendarClock,
    bar: 'bg-amber-500',
    washStrong: 'from-amber-500/25 via-amber-500/5 to-transparent dark:from-amber-400/30',
    washQuiet: 'from-amber-500/[0.08] via-transparent to-transparent dark:from-amber-400/15',
    glow: 'rgb(245 158 11)',
  },
  {
    key: 'message',
    title: 'A message',
    icon: MessageCircle,
    bar: 'bg-sky-500',
    washStrong: 'from-sky-500/25 via-sky-500/5 to-transparent dark:from-sky-400/30',
    washQuiet: 'from-sky-500/[0.08] via-transparent to-transparent dark:from-sky-400/15',
    glow: 'rgb(14 165 233)',
  },
  {
    key: 'sent',
    title: 'Sent',
    icon: Send,
    bar: 'bg-slate-400',
    washStrong: 'from-slate-500/20 via-transparent to-transparent dark:from-slate-400/25',
    washQuiet: 'from-slate-500/[0.06] via-transparent to-transparent dark:from-slate-400/10',
    glow: 'rgb(100 116 139)',
  },
];

const TOPIC_BY_KEY = Object.fromEntries(TOPICS.map((topic) => [topic.key, topic])) as Record<
  GroupKey,
  (typeof TOPICS)[number]
>;

const FILTER_FIELDS: PaymentsFilterField[] = [
  {
    key: 'state',
    label: 'State',
    options: [
      { value: 'needs', label: 'Needs a choice' },
      { value: 'unread', label: 'New' },
    ],
  },
];

const HANDLED_LABEL = {
  skipped: 'Skipped',
  moved: 'Moved',
  kept: 'Kept',
  dismissed: 'Dismissed',
} as const;

function needsChoice(item: ThreadListItem): boolean {
  return item.status === 'needs_attention' && !item.handled;
}

function rowStatus(item: ThreadListItem): string | null {
  if (needsChoice(item) && item.unread > 0) return 'New';
  if (needsChoice(item)) return 'Needs a choice';
  if (item.handled) return HANDLED_LABEL[item.handled];
  if (item.unread > 0) return 'New';
  return null;
}

function groupKey(item: ThreadListItem): GroupKey {
  if (item.topic === 'said_no') return 'cancel';
  if (item.topic === 'asked_move') return 'reschedule';
  if (item.topic === 'replied') return 'message';
  return 'sent';
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

function londonYmd(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function ThreadList(props: { items: ThreadListItem[]; emptyText: string }): JSX.Element {
  const { items, emptyText } = props;
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [wheres, setWheres] = useState<PaymentsWhere[]>([]);
  const [kind, setKind] = useState<GroupKey | null>(null);

  const summary: SummaryStripItem[] = TOPICS.map((topic) => ({
    key: topic.key,
    title: topic.title,
    icon: topic.icon,
    glow: topic.glow,
    count: items.filter((item) => groupKey(item) === topic.key).length,
  }));

  const needle = search.trim().toLowerCase();
  const whereActive = wheres.some((where) => where.field && where.value);
  const hasFilters = needle.length > 0 || Boolean(dateFrom || dateTo) || whereActive || kind != null;

  const filtered = items.filter((item) => {
    if (needle) {
      const haystack = [item.customerName, item.preview].join(' ').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    const day = londonYmd(item.lastAt) ?? '';
    if (dateFrom && (!day || day < dateFrom)) return false;
    if (dateTo && (!day || day > dateTo)) return false;
    if (kind && groupKey(item) !== kind) return false;
    for (const where of wheres) {
      if (!where.field || !where.value) continue;
      if (where.field === 'state' && where.value === 'unread' && item.unread <= 0) return false;
      if (where.field === 'state' && where.value === 'needs' && !needsChoice(item)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <SummaryStrip
        label="Messages"
        hint="· click to filter"
        activeKey={kind}
        onSelect={(key) => {
          setKind((current) => (current === key ? null : (key as GroupKey)));
        }}
        items={summary}
        gridClassName="grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3"
      />

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <>
          <PaymentsListFilters
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Customer or message…"
            dateLabel="Last message"
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateChange={({ date_from, date_to }) => {
              setDateFrom(date_from);
              setDateTo(date_to);
            }}
            fields={FILTER_FIELDS}
            wheres={wheres}
            onWheresChange={setWheres}
            hasFilters={hasFilters}
            onClear={() => {
              setSearch('');
              setDateFrom(undefined);
              setDateTo(undefined);
              setWheres([]);
              setKind(null);
            }}
          />
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing matches.
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map((item) => (
                <ThreadRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ThreadRow({ item }: { item: ThreadListItem }) {
  const topic = TOPIC_BY_KEY[groupKey(item)];
  const Icon = topic.icon;
  const unseen = item.unread > 0;
  const when = relativeTime(item.lastAt);
  const preview =
    item.previewDirection === 'outbound' && item.preview ? `You: ${item.preview}` : item.preview;
  const status = rowStatus(item);

  return (
    <li
      className="group relative list-none overflow-hidden rounded-2xl border border-border/70 bg-[var(--glass-bg)] shadow-[var(--shadow-glass-value)] transition-all duration-200 sm:hover:-translate-y-0.5 dark:border-white/[0.06]"
    >
      <div className={cn('pointer-events-none absolute inset-y-0 left-0 w-1', topic.bar)} aria-hidden />
      <div
        className={cn(
          'pointer-events-none absolute inset-0 bg-gradient-to-r',
          unseen ? topic.washStrong : topic.washQuiet,
        )}
        aria-hidden
      />
      <Link
        href={item.id.startsWith('sample-') ? '#' : `/messages/${item.id}`}
        onClick={item.id.startsWith('sample-') ? (event) => event.preventDefault() : undefined}
        className="relative flex items-start gap-3 p-3 pl-4 sm:p-4 sm:pl-5"
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full border"
          style={{
            borderColor: topic.glow.replace(')', ' / 0.45)'),
            backgroundColor: topic.glow.replace(')', ' / 0.12)'),
            color: topic.glow,
          }}
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[15px] tracking-tight', unseen ? 'font-semibold' : 'font-medium')}>
            {item.customerName}
          </span>
          {preview ? (
            <span className="mt-1 block truncate text-sm text-foreground/80">{preview}</span>
          ) : null}
        </span>
        {status || when ? (
          <span className="flex shrink-0 flex-col items-end gap-1 text-right">
            {status ? <span className="text-xs font-medium text-foreground">{status}</span> : null}
            {when ? <span className="text-xs text-muted-foreground">{when}</span> : null}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
