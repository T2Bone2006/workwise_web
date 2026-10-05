import Link from 'next/link';
import { CalendarX2, CheckCircle2, ChevronRight, MessageCircle, Receipt, Wallet, type LucideIcon } from 'lucide-react';
import type { NeedsYou } from '@/lib/data/rounds/needs-you';
import { formatGbp } from '@/lib/money/pence';
import { formatDayMonth, formatShortDate, plural, SectionCard } from './shared';

type Need = { key: string; icon: LucideIcon; colour: string; count: string; title: string; detail: string; href: string };

/** The drawing's three icon colours: amber for replies and visits, rose for money owed, purple for receipts. */
const AMBER = '#d4920c';
const ROSE = 'var(--tone-rose-solid)';
const PURPLE = '#9b30d9';

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
      colour: AMBER,
      count: String(needs.repliesToReview),
      title: needs.repliesToReview === 1 ? 'Customer reply to read' : 'Customer replies to read',
      detail: `${needs.replyNames.join(', ')}${more > 0 ? ` and ${more} more` : ''}`,
      href: '/messages',
    });
  }
  if (owed.total > 0) {
    const top = owed.top[0];
    out.push({
      key: 'owed',
      icon: Wallet,
      colour: ROSE,
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
      colour: AMBER,
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
      colour: PURPLE,
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
      title="Needs you"
      summary={list.length > 0 ? `${plural(list.length, 'thing', 'things')} waiting` : undefined}
      aside={
        list.length > 0 ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900 tabular-nums dark:bg-amber-500/20 dark:text-amber-200">
            {list.length}
          </span>
        ) : null
      }
      labelledBy="needs-heading"
      className="h-full"
    >
      {list.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl bg-(--tone-emerald-soft) px-4 py-8 text-center">
          <CheckCircle2 className="size-8 text-(--tone-emerald-text)" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold">Nothing needs you. Nice.</p>
          <p className="mt-0.5 text-sm text-muted-foreground">No replies, money owed, missed visits or receipts waiting.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {list.map((need) => (
            <li key={need.key}>
              <Link
                href={need.href}
                className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `color-mix(in srgb, ${need.colour} 13%, transparent)`, color: need.colour }}
                >
                  <need.icon className="size-[17px]" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    <span className="tabular-nums">{need.count}</span> {need.title.toLowerCase()}
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
