import Link from 'next/link';
import { quoteLabel } from '@/components/lite/leads/lead-card';
import { londonWhen } from '@/components/lite/conversation-transcript';
import type { ConversationListItem } from '@/lib/data/lite/conversations';
import { litePaths } from '@/lib/navigation/lite-paths';
import { todayInLondon } from '@/lib/rounds/dates';
import { Avatar, Tag, type Tone } from '@/components/look';
import { cn } from '@/lib/utils';

const TAG_LABEL: Record<string, string> = {
  lead: 'Lead',
  booking: 'Booking',
  firm_price: 'Firm price',
  guide_price: 'Guide price',
  visit_offered: 'Visit offered',
  out_of_area: 'Out of area',
  question_only: 'Question only',
  no_details: 'No details',
  off_topic: 'Off topic',
};

const STATUS_LABEL = { new: 'New', contacted: 'Contacted', won: 'Won', lost: 'Lost' } as const;

const STATUS_TONE: Record<keyof typeof STATUS_LABEL, Tone> = {
  new: 'rounds',
  contacted: 'indigo',
  won: 'emerald',
  lost: 'slate',
};

function londonYmd(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function conversationWhen(iso: string, now = new Date()): string {
  const when = londonWhen(iso);
  const ymd = londonYmd(iso);
  if (!when || !ymd) return '';
  if (ymd === todayInLondon(now)) return `Today ${when.hm}`;
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
  return `${day} ${when.hm}`;
}

function lineFor(item: ConversationListItem): { text: string; muted: boolean } {
  if (item.status === 'active' && !item.summary) return { text: 'Still chatting\u2026', muted: false };
  if (item.summary) return { text: item.summary, muted: false };
  return { text: 'No summary', muted: true };
}

export function ConversationRow({ item, now }: { item: ConversationListItem; now?: Date }) {
  const line = lineFor(item);
  const price = quoteLabel(item.quote);
  const seen = new Set<string>();
  const tags = item.tags.filter((tag) => {
    if (seen.has(tag)) return false;
    seen.add(tag);
    return true;
  });
  const reopened = item.status === 'active' && item.summary != null;

  return (
    <li className="list-none rounded-2xl border border-border bg-card shadow-(--look-card-shadow) transition-colors hover:border-(--tone-slate-solid)/40">
      <div className="flex min-w-0 flex-col gap-3 p-3.5 md:flex-row md:items-center md:justify-between">
        <Link href={litePaths.conversation(item.id)} className="flex min-w-0 flex-1 items-start gap-3">
          <Avatar name={item.lead?.firstName ?? '?'} tone={item.lead ? STATUS_TONE[item.lead.status] : 'slate'} />
          <span className="min-w-0 flex-1">
            <span className={cn('block text-sm', line.muted ? 'text-muted-foreground' : 'font-medium')}>{line.text}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <time className="mr-1 text-xs text-muted-foreground tabular-nums">{conversationWhen(item.startedAt, now)}</time>
              {reopened ? <Tag tone="rounds">Still chatting</Tag> : null}
              {tags.map((tag) => (
                <Tag key={tag} tone="slate">
                  {TAG_LABEL[tag] ?? tag}
                </Tag>
              ))}
            </span>
          </span>
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-2 pl-12 md:max-w-[16rem] md:justify-end md:pl-0">
          {price ? <span className="text-sm font-semibold tabular-nums">{price}</span> : null}
          {item.lead ? (
            <Link href={litePaths.lead(item.lead.id)}>
              <Tag tone={STATUS_TONE[item.lead.status]}>
                {item.lead.firstName} · {STATUS_LABEL[item.lead.status]}
              </Tag>
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">No details left</span>
          )}
        </div>
      </div>
    </li>
  );
}
