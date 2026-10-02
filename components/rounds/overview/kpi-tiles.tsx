import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarRange, PoundSterling, Sun, Wallet, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { TrendMonth } from '@/lib/books/trend';
import { formatGbp } from '@/lib/money/pence';
import type { TodayRound } from '@/lib/rounds/today-strip';
import type { WeekGlance } from '@/lib/rounds/week-glance';
import { cn } from '@/lib/utils';
import { formatDayMonth, IconChip, plural, TONE, type Tone } from './shared';

function Tile({
  href,
  icon,
  tone,
  label,
  value,
  children,
}: {
  href: string;
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="group rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
      <Card
        className={cn(
          'glass-card h-full gap-0 p-3 transition-all sm:p-4 duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md',
          TONE[tone].border,
        )}
      >
        <p className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <IconChip icon={icon} tone={tone} size="sm" />
          {label}
        </p>
        <p className={cn('mt-2 text-xl font-semibold tracking-tight tabular-nums sm:mt-3 sm:text-2xl', TONE[tone].text)}>{value}</p>
        <div className="mt-1 text-xs text-muted-foreground">{children}</div>
      </Card>
    </Link>
  );
}

function Change({ now, before, beforeLabel }: { now: number; before: number; beforeLabel: string }) {
  if (before <= 0) return <span>Nothing had come in by this date in {beforeLabel}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const up = pct >= 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cn('inline-flex items-center font-medium', up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
        <Arrow className="size-3.5" aria-hidden="true" />
        {Math.abs(pct)}%
      </span>
      vs {formatGbp(before)} by this date in {beforeLabel}
    </span>
  );
}

/**
 * The four numbers worth knowing on opening the app: today's takings, this week's
 * booked work, money in this month against last month, and what's owed.
 */
export function KpiTiles({
  today,
  week,
  trend,
  monthToDateLast,
  owed,
}: {
  today: TodayRound;
  week: WeekGlance | null;
  trend: TrendMonth[] | null;
  /** Money in last month up to the same day of the month, for a fair comparison. */
  monthToDateLast: number | null;
  owed: { total: number; customers: number; oldestDate: string | null };
}) {
  const thisMonth = trend?.at(-1);
  const lastMonth = trend?.at(-2);
  const pctDone = today.stops > 0 ? Math.round((today.done / today.stops) * 100) : 0;

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
      <Tile href="/calendar?view=day" icon={Sun} tone="sky" label="Today" value={formatGbp(today.doneAmount)}>
        {today.stops === 0 ? (
          'Nothing booked today'
        ) : (
          <>
            <span>
              of {formatGbp(today.plannedAmount)} · {today.done} of {plural(today.stops, 'stop', 'stops')} done
            </span>
            <span
              className="mt-2 block h-1.5 overflow-hidden rounded-full bg-sky-500/15"
              role="progressbar"
              aria-valuenow={pctDone}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Stops done today"
            >
              <span className="block h-full rounded-full bg-sky-500" style={{ width: `${pctDone}%` }} />
            </span>
          </>
        )}
      </Tile>

      <Tile
        href="/calendar?view=week"
        icon={CalendarRange}
        tone="indigo"
        label="This week"
        value={week ? formatGbp(week.amount) : '—'}
      >
        {week
          ? `${plural(week.stops, 'stop', 'stops')} booked · ${week.freeDays === 0 ? 'no free days left' : plural(week.freeDays, 'free day', 'free days')}`
          : 'Couldn’t load this week'}
      </Tile>

      <Tile
        href="/expenses?tab=in-out"
        icon={PoundSterling}
        tone="emerald"
        label={thisMonth ? `Money in · ${thisMonth.label}` : 'Money in'}
        value={thisMonth ? formatGbp(thisMonth.moneyIn) : '—'}
      >
        {thisMonth && lastMonth && monthToDateLast != null ? (
          <Change now={thisMonth.moneyIn} before={monthToDateLast} beforeLabel={lastMonth.label} />
        ) : (
          'Payments received this month'
        )}
      </Tile>

      <Tile
        href="/payments?view=overdue"
        icon={Wallet}
        tone={owed.total > 0 ? 'rose' : 'emerald'}
        label="Owed to you"
        value={formatGbp(owed.total)}
      >
        {owed.total > 0
          ? `${plural(owed.customers, 'customer', 'customers')}${owed.oldestDate ? ` · oldest since ${formatDayMonth(owed.oldestDate)}` : ''}`
          : 'Everyone’s paid up'}
      </Tile>
    </div>
  );
}
