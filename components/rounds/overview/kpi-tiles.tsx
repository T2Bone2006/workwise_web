import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { toneClasses } from '@/components/look';
import type { TrendMonth } from '@/lib/books/trend';
import { formatGbp } from '@/lib/money/pence';
import type { TodayRound } from '@/lib/rounds/today-strip';
import type { WeekGlance } from '@/lib/rounds/week-glance';
import { cn } from '@/lib/utils';
import { formatDayMonth, plural } from './shared';

function Change({ now, before, beforeLabel }: { now: number; before: number; beforeLabel: string }) {
  if (before <= 0) return <span>Nothing had come in by this date in {beforeLabel}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const up = pct >= 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cn('inline-flex items-center font-medium', toneClasses(up ? 'emerald' : 'rose').text)}>
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
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <Kpi
        href="/calendar?view=day"
        label="Today"
        value={formatGbp(today.doneAmount)}
        figure="text-(--tone-rounds-solid)"
        sub={
          today.stops === 0 ? (
            'Nothing booked today'
          ) : (
            <>
              <span>
                of {formatGbp(today.plannedAmount)} · {today.done} of {plural(today.stops, 'stop', 'stops')} done
              </span>
              <span
                className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={pctDone}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Stops done today"
              >
                <span className="block h-full rounded-full bg-(--tone-rounds-solid)" style={{ width: `${pctDone}%` }} />
              </span>
            </>
          )
        }
      />

      <Kpi
        href="/calendar?view=week"
        label="This week"
        value={week ? formatGbp(week.amount) : '—'}
        figure="text-foreground"
        sub={
          week
            ? `${plural(week.stops, 'stop', 'stops')} booked · ${week.freeDays === 0 ? 'no free days left' : plural(week.freeDays, 'free day', 'free days')}`
            : 'Couldn’t load this week'
        }
      />

      <Kpi
        href="/expenses?tab=in-out"
        label={thisMonth ? `Money in · ${thisMonth.label}` : 'Money in'}
        value={thisMonth ? formatGbp(thisMonth.moneyIn) : '—'}
        figure="text-(--tone-emerald-solid)"
        sub={
          thisMonth && lastMonth && monthToDateLast != null ? (
            <Change now={thisMonth.moneyIn} before={monthToDateLast} beforeLabel={lastMonth.label} />
          ) : (
            'Payments received this month'
          )
        }
      />

      <Kpi
        href="/payments?view=overdue"
        label="Owed to you"
        value={formatGbp(owed.total)}
        figure={owed.total > 0 ? 'text-(--tone-rose-solid)' : 'text-(--tone-emerald-solid)'}
        sub={
          owed.total > 0
            ? `${plural(owed.customers, 'customer', 'customers')}${owed.oldestDate ? ` · oldest since ${formatDayMonth(owed.oldestDate)}` : ''}`
            : 'Everyone’s paid up'
        }
      />
    </div>
  );
}

/** One of the four numbers, as in the site's drawing: small label, big vivid figure, a grey line under. */
function Kpi({
  href,
  label,
  value,
  figure,
  sub,
}: {
  href: string;
  label: string;
  value: string;
  figure: string;
  sub: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-border bg-card px-4 py-4 transition-colors hover:border-(--tone-slate-solid)/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:px-5"
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-[26px] leading-none font-semibold tracking-tight tabular-nums', figure)}>{value}</p>
      <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{sub}</div>
    </Link>
  );
}
