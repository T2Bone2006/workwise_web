import Link from 'next/link';
import { BellRing, CalendarX2, CheckCircle2, ChevronRight, MessageCircle, Receipt, Wallet, type LucideIcon } from 'lucide-react';
import type { NeedsYou } from '@/lib/data/rounds/needs-you';
import { formatGbp } from '@/lib/money/pence';
import { cn } from '@/lib/utils';
import { formatDayMonth, formatShortDate, IconChip, plural, SectionCard, TONE, type Tone } from './shared';

type Need = { key: string; icon: LucideIcon; tone: Tone; count: string; title: string; detail: string; href: string };

function needsFrom(
  needs: NeedsYou,
  owed: { total: number; customers: number; top: Array<{ name: string; amount: number }>; oldestDate: string | null },
): Need[] {
  const out: Need[] = [];
  if (needs.repliesToReview > 0) {
    const more = needs.repliesToReview - needs.replyNames.length;
    out.push({
      key: 'replies',
      icon: MessageCircle,
      tone: 'sky',
      count: String(needs.repliesToReview),
      title: needs.repliesToReview === 1 ? 'Customer reply to read' : 'Customer replies to read',
      detail: `${needs.replyNames.join(', ')}${more > 0 ? ` and ${more} more` : ''} · about upcoming visits`,
      href: '/messages',
    });
  }
  if (owed.total > 0) {
    const top = owed.top[0];
    out.push({
      key: 'owed',
      icon: Wallet,
      tone: 'rose',
      count: formatGbp(owed.total),
      title: `Owed by ${plural(owed.customers, 'customer', 'customers')}`,
      detail: [
        top ? `Most: ${top.name}, ${formatGbp(top.amount)}` : null,
        owed.oldestDate ? `oldest since ${formatDayMonth(owed.oldestDate)}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      href: '/payments?view=overdue',
    });
  }
  if (needs.missedVisits > 0) {
    out.push({
      key: 'missed',
      icon: CalendarX2,
      tone: 'amber',
      count: String(needs.missedVisits),
      title: needs.missedVisits === 1 ? 'Visit left from an earlier day' : 'Visits left from earlier days',
      detail: `Not marked done or skipped${needs.oldestMissedDate ? ` · oldest ${formatShortDate(needs.oldestMissedDate)}` : ''}`,
      href: needs.oldestMissedDate ? `/calendar?view=day&date=${needs.oldestMissedDate}` : '/calendar',
    });
  }
  if (needs.receiptsToCheck > 0) {
    out.push({
      key: 'receipts',
      icon: Receipt,
      tone: 'violet',
      count: String(needs.receiptsToCheck),
      title: needs.receiptsToCheck === 1 ? 'Receipt to check' : 'Receipts to check',
      detail: `Scanned, waiting for you to save${needs.receiptsAmount > 0 ? ` · ${formatGbp(needs.receiptsAmount)}` : ''}`,
      href: '/expenses',
    });
  }
  return out;
}

/** Everything waiting on the owner, most pressing first. Each line opens the place to deal with it. */
export function NeedsYouCard({
  needs,
  owed,
}: {
  needs: NeedsYou;
  owed: { total: number; customers: number; top: Array<{ name: string; amount: number }>; oldestDate: string | null };
}) {
  const list = needsFrom(needs, owed);

  return (
    <SectionCard
      icon={BellRing}
      tone={list.length > 0 ? 'amber' : 'emerald'}
      title="Needs you"
      summary={list.length > 0 ? `${plural(list.length, 'thing', 'things')} waiting` : 'Nothing waiting'}
      labelledBy="needs-heading"
      className="h-full"
    >
      {list.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] px-4 py-8 text-center">
          <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold">All clear</p>
          <p className="mt-0.5 text-sm text-muted-foreground">No replies, money owed, missed visits or receipts waiting.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((need) => (
            <li key={need.key}>
              <Link
                href={need.href}
                className={cn(
                  'group flex items-center gap-3 rounded-xl border p-3 transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  TONE[need.tone].border,
                  TONE[need.tone].soft,
                  'hover:bg-muted/60',
                )}
              >
                <IconChip icon={need.icon} tone={need.tone} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    <span className={cn('tabular-nums', TONE[need.tone].text)}>{need.count}</span> {need.title.toLowerCase()}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{need.detail}</p>
                </div>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
