'use client';

import { useMemo, useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Link from 'next/link';
import { CalendarDays, CircleAlert, CircleCheck, TrendingUp, Wallet } from 'lucide-react';
import { IconChip, Legend, LookCard, StatTile, toneClasses } from '@/components/look';
import { ChaseList } from '@/components/payments/chase-list';
import { PaymentFeed } from '@/components/payments/payment-feed';
import { owedAge, summariseOwedBands } from '@/components/payments/owed-age';
import type { EarningsHour, EarningsOverview, EarningsPoint, PaymentHistoryRow } from '@/lib/data/payments/history';
import type { OwedCustomerRow } from '@/lib/data/payments/owed';
import { cn } from '@/lib/utils';
import { formatGbp } from '@/lib/money/pence';
import { addDays, endOfMonth, isoWeekday, startOfMonth } from '@/lib/rounds/dates';

type RangeKey = 'day' | 'week' | 'month' | 'year';

const RANGES: { value: RangeKey; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function previousBounds(range: RangeKey, today: string): { from: string; to: string; label: string } | null {
  if (range === 'day') {
    const day = addDays(today, -1);
    return { from: day, to: day, label: 'Yesterday' };
  }
  if (range === 'week') {
    const { from } = bounds('week', today);
    const prev = addDays(from, -7);
    return { from: prev, to: addDays(prev, 6), label: 'Last week' };
  }
  if (range === 'month') {
    const prev = startOfMonth(addDays(startOfMonth(today), -1));
    return { from: prev, to: endOfMonth(prev), label: 'Last month' };
  }
  return null;
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function bounds(range: RangeKey, today: string): { from: string; to: string } {
  if (range === 'day') return { from: today, to: today };
  if (range === 'week') {
    const from = addDays(today, 1 - isoWeekday(today));
    return { from, to: addDays(from, 6) };
  }
  if (range === 'month') return { from: startOfMonth(today), to: endOfMonth(today) };
  return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
}

function hourLabel(hour: number): string {
  if (hour === 0) return '12am';
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return '12pm';
  return `${hour - 12}pm`;
}

function hourBuckets(hours: EarningsHour[]) {
  const active = hours.filter((row) => row.income || row.booked || row.owed || row.paid);
  const earliest = active.length > 0 ? Math.min(...active.map((row) => row.hour)) : 7;
  const latest = active.length > 0 ? Math.max(...active.map((row) => row.hour)) : 19;
  const from = Math.min(7, earliest);
  const to = Math.max(19, latest);
  return hours
    .filter((row) => row.hour >= from && row.hour <= to)
    .map((row) => ({
      label: hourLabel(row.hour),
      date: String(row.hour),
      income: row.income,
      booked: row.booked,
      owed: row.owed,
      paid: row.paid,
    }));
}

function chartRows(points: EarningsPoint[], hours: EarningsHour[], range: RangeKey, today: string) {
  const { from, to } = bounds(range, today);
  const slice = points.filter((point) => inRange(point.date, from, to));
  const buckets =
    range === 'day'
      ? hourBuckets(hours)
      :
    range === 'year'
      ? MONTHS.map((label, index) => {
          const month = String(index + 1).padStart(2, '0');
          const days = slice.filter((point) => point.date.slice(5, 7) === month);
          return {
            label,
            date: `${today.slice(0, 4)}-${month}-01`,
            income: days.reduce((sum, day) => sum + (day.date <= today ? day.income : 0), 0),
            booked: days.reduce((sum, day) => sum + day.booked, 0),
            owed: days.reduce((sum, day) => sum + day.owed, 0),
            paid: days.reduce((sum, day) => sum + day.paid, 0),
          };
        })
      : slice.map((point) => ({
          label: range === 'month' ? String(Number(point.date.slice(8, 10))) : point.date.slice(8, 10),
          date: point.date,
          income: point.date > today ? 0 : point.income,
          booked: point.booked,
          owed: point.owed,
          paid: point.paid,
        }));

  let expected = 0;
  return buckets.map((bucket) => {
    expected += bucket.paid + bucket.owed + bucket.booked;
    return { ...bucket, expected };
  });
}

/** A row of small bars, one per day (or month, or hour): the shape of the figure above it. */
function Spark({ values, tone, caption }: { values: number[]; tone: 'emerald' | 'indigo'; caption: string }) {
  const max = Math.max(...values, 1);
  return (
    <div>
      <div className="flex h-9 items-end gap-px" aria-hidden="true">
        {values.map((value, index) => (
          <span
            key={index}
            className={cn('min-w-px flex-1 rounded-[1px]', value > 0 ? toneClasses(tone).solid : 'bg-muted')}
            style={{ height: value > 0 ? `${Math.max(8, (value / max) * 100)}%` : '3px', opacity: value > 0 ? 0.85 : 1 }}
          />
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{caption}</p>
    </div>
  );
}

export function PaymentsOverview({
  earnings,
  owedRows,
  historyRows,
  today,
}: {
  earnings: EarningsOverview;
  owedRows: OwedCustomerRow[];
  historyRows: PaymentHistoryRow[];
  today: string;
}) {
  const [range, setRange] = useState<RangeKey>('month');
  const rows = useMemo(
    () => chartRows(earnings.points, earnings.hours ?? [], range, today),
    [earnings.points, earnings.hours, range, today],
  );
  const cameIn = rows.reduce((sum, row) => sum + row.income, 0);
  const booked = rows.reduce((sum, row) => sum + row.booked, 0);
  const expectedTotal = rows.length > 0 ? rows[rows.length - 1]!.expected : 0;
  const rangeLabel = RANGES.find((item) => item.value === range)?.label ?? 'This month';

  const previous = previousBounds(range, today);
  const previousIn = previous
    ? earnings.points
        .filter((point) => inRange(point.date, previous.from, previous.to))
        .reduce((sum, point) => sum + point.income, 0)
    : null;

  const owing = owedRows.filter((row) => row.owedAmount > 0);
  const owedTotal = owing.reduce((sum, row) => sum + row.owedAmount, 0);
  const bands = summariseOwedBands(owing, today);
  const oldest = owing.reduce<string | null>(
    (acc, row) => (row.oldestUnpaidDate && (!acc || row.oldestUnpaidDate < acc) ? row.oldestUnpaidDate : acc),
    null,
  );
  const oldestAge = owedAge(oldest, today);

  const recent = [...historyRows]
    .filter((row) => row.status === 'active')
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, 7);
  const chase = owing.slice(0, 8);
  const unit = range === 'day' ? 'hour' : range === 'year' ? 'month' : 'day';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">How the money looks</h2>
        <div
          role="group"
          aria-label="Time range"
          className="inline-flex rounded-xl bg-look-segment p-1 text-sm"
        >
          {RANGES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setRange(item.value)}
              aria-pressed={range === item.value}
              className={cn(
                'rounded-lg px-3 py-1 font-medium text-muted-foreground transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                range === item.value && 'bg-card text-foreground shadow-(--look-card-shadow)',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr]">
        <section className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:p-4">
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <IconChip icon={owedTotal > 0 ? CircleAlert : CircleCheck} tone={owedTotal > 0 ? 'rose' : 'emerald'} size="sm" />
            Owed to you
          </p>
          <p
            className={cn(
              'mt-2.5 text-2xl font-semibold tracking-tight tabular-nums sm:text-[28px]',
              toneClasses(owedTotal > 0 ? 'rose' : 'emerald').figure,
            )}
          >
            {formatGbp(owedTotal)}
          </p>
          {owedTotal > 0 ? (
            <>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Finished visits, not paid yet · {owing.length === 1 ? '1 customer' : `${owing.length} customers`}
                {oldestAge ? `, the longest waiting ${oldestAge.label}` : ''}
              </p>
              <div className="mt-3.5 flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Money owed, by how long customers have waited">
                {bands
                  .filter((band) => band.amount > 0)
                  .map((band) => (
                    <span
                      key={band.key}
                      className={cn('h-full min-w-1.5', toneClasses(band.tone).solid)}
                      style={{ width: `${(band.amount / owedTotal) * 100}%` }}
                    />
                  ))}
              </div>
              <ul className="mt-2.5 grid gap-1 text-xs">
                {bands.map((band) => (
                  <li key={band.key}>
                    <Link
                      href={`/payments?view=overdue&age=${band.key}`}
                      className="flex items-center gap-2 rounded-md py-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <span className={cn('size-2.5 shrink-0 rounded-full', toneClasses(band.tone).solid)} aria-hidden="true" />
                      <span className="flex-1">{band.label}</span>
                      <span className="tabular-nums">
                        {band.count === 1 ? '1 customer' : `${band.count} customers`}
                      </span>
                      <span className="w-16 text-right font-medium text-foreground tabular-nums">
                        {formatGbp(band.amount)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Nobody owes you anything. Every finished visit is paid for.</p>
          )}
        </section>
        <StatTile
          label={`Money in · ${rangeLabel}`}
          value={formatGbp(cameIn)}
          tone="emerald"
          icon={Wallet}
          sub={
            previous && previousIn != null
              ? `${previous.label}: ${formatGbp(previousIn)}`
              : 'Money already received.'
          }
          footer={<Spark values={rows.map((row) => row.income)} tone="emerald" caption={`Money in each ${unit}`} />}
        />
        <StatTile
          label={`Coming · ${rangeLabel}`}
          value={formatGbp(booked)}
          tone="indigo"
          icon={CalendarDays}
          sub={`Visits on the calendar, not done yet. ${formatGbp(expectedTotal)} expected altogether.`}
          footer={<Spark values={rows.map((row) => row.booked)} tone="indigo" caption={`Booked work each ${unit}`} />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <LookCard
          title="Who to chase"
          icon={CircleAlert}
          tone="rose"
          aside={
            <Link href="/payments?view=overdue" className="text-sm font-medium text-primary hover:underline">
              {owing.length > chase.length ? `See all ${owing.length}` : 'Oldest first'}
            </Link>
          }
        >
          {chase.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl bg-(--tone-emerald-soft) px-4 py-5 text-sm">
              <IconChip icon={CircleCheck} tone="emerald" />
              <span>
                <span className="block font-medium text-(--tone-emerald-text)">Nobody owes you anything.</span>
                <span className="text-muted-foreground">New visits show up here once they are done and not paid for.</span>
              </span>
            </div>
          ) : (
            <ChaseList rows={chase} today={today} />
          )}
        </LookCard>
        <LookCard
          title="Recent payments"
          icon={Wallet}
          tone="emerald"
          aside={
            <Link href="/payments?view=received" className="text-sm font-medium text-primary hover:underline">
              See all
            </Link>
          }
        >
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing has come in lately.</p>
          ) : (
            <PaymentFeed rows={recent} today={today} />
          )}
        </LookCard>
      </div>

      <LookCard title={`Money over time · ${rangeLabel}`} icon={TrendingUp} tone="rounds">
        <Legend
          className="mb-3"
          items={[
            { label: 'Paid', tone: 'emerald' },
            { label: 'Not paid yet', tone: 'rose' },
            { label: 'Not done yet', tone: 'indigo' },
            { label: 'Total so far', tone: 'rounds' },
          ]}
        />
        <div className="h-60 text-muted-foreground">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="expectedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--tone-rounds-solid)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--tone-rounds-solid)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'currentColor' }}
                tickLine={false}
                axisLine={false}
                interval={range === 'month' || range === 'day' ? 1 : 0}
              />
              <YAxis
                width={56}
                tick={{ fontSize: 11, fill: 'currentColor' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => `£${value}`}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const value = (key: string) =>
                    Number(payload.find((item) => item.dataKey === key)?.value ?? 0);
                  return (
                    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-(--look-card-shadow)">
                      <p className="mb-1 font-semibold text-foreground">{label}</p>
                      <p className={toneClasses('emerald').text}>Paid {formatGbp(value('paid'))}</p>
                      <p className={toneClasses('rose').text}>Not paid yet {formatGbp(value('owed'))}</p>
                      <p className={toneClasses('indigo').text}>Not done yet {formatGbp(value('booked'))}</p>
                      <p className={toneClasses('rounds').text}>Total so far {formatGbp(value('expected'))}</p>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="expected"
                stroke="var(--tone-rounds-solid)"
                strokeWidth={2}
                fill="url(#expectedFill)"
                dot={false}
              />
              <Bar dataKey="paid" stackId="day" fill="var(--tone-emerald-solid)" maxBarSize={26} />
              <Bar dataKey="owed" stackId="day" fill="var(--tone-rose-solid)" maxBarSize={26} />
              <Bar dataKey="booked" stackId="day" fill="var(--tone-indigo-solid)" fillOpacity={0.55} maxBarSize={26} radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </LookCard>
      {earnings.error ? <p className="text-sm text-destructive">{earnings.error}</p> : null}
    </div>
  );
}
