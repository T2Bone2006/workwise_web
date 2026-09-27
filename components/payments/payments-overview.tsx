'use client';

import { useMemo, useState } from 'react';
import { Area, Bar, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, CircleAlert, TrendingUp, Wallet } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { EarningsHour, EarningsOverview, EarningsPoint } from '@/lib/data/payments/history';
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

export function PaymentsOverview({
  earnings,
  owed,
  today,
}: {
  earnings: EarningsOverview;
  owed: number;
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

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="glass-card border-emerald-500/25">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex size-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                <Wallet className="size-3.5" />
              </span>
              Paid
            </p>
            <p className="mt-3 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
              {formatGbp(cameIn)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Money already received.</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-rose-500/25">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex size-7 items-center justify-center rounded-full bg-rose-500/15 text-rose-500">
                <CircleAlert className="size-3.5" />
              </span>
              Owed
            </p>
            <p className="mt-3 text-2xl font-semibold tabular-nums text-rose-700 dark:text-rose-300">
              {formatGbp(owed)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Finished visits, not paid yet.</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-amber-500/30">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex size-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
                <CalendarDays className="size-3.5" />
              </span>
              Booked · {rangeLabel}
            </p>
            <p className="mt-3 text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">
              {formatGbp(booked)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Visits on the calendar, not done yet.</p>
          </CardContent>
        </Card>
        <Card className="glass-card border-blue-500/30">
          <CardContent className="p-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex size-7 items-center justify-center rounded-full bg-blue-500/15 text-blue-500">
                <TrendingUp className="size-3.5" />
              </span>
              Expected
            </p>
            <p className="mt-3 text-2xl font-semibold tabular-nums text-blue-700 dark:text-blue-300">
              {formatGbp(expectedTotal)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              What the visits add up to. It only goes up.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card border-border/80">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <h2 className="-mt-5 text-sm font-semibold">{rangeLabel}</h2>
            <select
              aria-label="Time range"
              value={range}
              onChange={(event) => setRange(event.target.value as RangeKey)}
              className="-mt-5 rounded-md border border-input bg-transparent px-2 py-1 text-xs text-foreground"
            >
              {RANGES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="expectedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(59 130 246)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="rgb(59 130 246)" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
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
                  cursor={{ fill: 'rgb(255 255 255 / 0.04)' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const value = (key: string) =>
                      Number(payload.find((item) => item.dataKey === key)?.value ?? 0);
                    return (
                      <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
                        <p className="font-medium">{label}</p>
                        <p className="text-emerald-600 dark:text-emerald-300">Paid {formatGbp(value('paid'))}</p>
                        <p className="text-rose-600 dark:text-rose-300">Not paid yet {formatGbp(value('owed'))}</p>
                        <p className="text-amber-600 dark:text-amber-300">Not done yet {formatGbp(value('booked'))}</p>
                        <p className="text-blue-600 dark:text-blue-300">Total so far {formatGbp(value('expected'))}</p>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="expected"
                  stroke="rgb(59 130 246)"
                  strokeWidth={2}
                  fill="url(#expectedFill)"
                  dot={false}
                />
                <Bar dataKey="paid" stackId="day" fill="rgb(16 185 129)" maxBarSize={28} />
                <Bar dataKey="owed" stackId="day" fill="rgb(244 63 94)" maxBarSize={28} />
                <Bar dataKey="booked" stackId="day" fill="rgb(251 191 36)" maxBarSize={28} radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      {earnings.error ? <p className="text-sm text-destructive">{earnings.error}</p> : null}
    </div>
  );
}
