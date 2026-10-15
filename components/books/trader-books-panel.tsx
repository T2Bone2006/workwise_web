'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Landmark, Receipt, Scale, TrendingDown, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
import { IconChip, Legend, LookCard, StatTile, toneClasses, type Tone } from '@/components/look';
import { EXPENSE_CATEGORY_ICON } from '@/components/books/category-style';
import { methodIcon, methodTone } from '@/components/payments/method-style';
import { periodParam } from '@/lib/books/periods';
import type { BooksSummary } from '@/lib/books/summary-pure';
import { formatGbp } from '@/lib/money/pence';
import { paymentMethodLabel } from '@/lib/payments/method-labels';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const money = (n: number) => formatGbp(n, { always2dp: true });

function Amount({ value, className }: { value: number; className?: string }) {
  return <span className={cn('tabular-nums', value < 0 && 'text-destructive', className)}>{money(value)}</span>;
}

/** A line with a share bar under it, so the biggest thing reads first. */
function ShareRow({
  icon: Icon,
  label,
  note,
  amount,
  share,
  tone,
  muted = false,
}: {
  icon?: LucideIcon;
  label: string;
  note?: string;
  amount: number;
  share: number;
  tone: Tone;
  muted?: boolean;
}) {
  return (
    <li className={cn('py-2.5', muted && 'opacity-50')}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2.5">
          {Icon ? (
            <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', toneClasses(tone).chip)}>
              <Icon className="size-3.5" />
            </span>
          ) : null}
          <span className="truncate">{label}</span>
          {note ? <span className="shrink-0 text-xs text-muted-foreground">{note}</span> : null}
        </span>
        <Amount value={amount} className="font-medium" />
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={cn('h-full rounded-full', toneClasses(tone).solid)} style={{ width: `${Math.max(share, amount > 0 ? 3 : 0)}%` }} />
      </div>
    </li>
  );
}

/** The trader's view in the new look: what's left, where it came from, where it went, month by month. */
export function TraderBooksPanel({ summary, monthBase }: { summary: BooksSummary; monthBase?: string }) {
  const monthHref = monthBase
    ? (year: number, month: number) => `${monthBase}&period=${periodParam({ kind: 'month', year, month })}`
    : undefined;
  const { period, vat } = summary;
  const [showAll, setShowAll] = useState(false);
  const empty = summary.paymentsCount === 0 && summary.moneyOut === 0;
  const inMax = Math.max(1, ...summary.moneyInByMethod.map((row) => row.amount));
  const spent = summary.moneyOutByCategory.filter((row) => row.amount > 0 || row.count > 0);
  const unused = summary.moneyOutByCategory.length - spent.length;
  const categories = showAll ? summary.moneyOutByCategory : spent;
  const outTotal = Math.max(summary.moneyOut, 0.01);
  const flow = summary.moneyIn + summary.moneyOut;
  const chartRows = summary.months?.map((m) => ({
    label: m.label.slice(0, 3),
    full: m.label,
    moneyIn: m.moneyIn,
    moneyOut: m.moneyOut,
  }));

  return (
    <div className="space-y-4">
      {empty ? (
        <p className="rounded-2xl border border-dashed border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Nothing in or out in {period.label.replace(' tax year', '')}.
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr]">
        <section className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:p-5">
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <IconChip icon={Scale} tone={summary.left < 0 ? 'rose' : 'rounds'} size="sm" />
            Left in your pocket
          </p>
          <p
            className={cn(
              'mt-2.5 text-3xl font-semibold tracking-tight tabular-nums sm:text-[34px]',
              toneClasses(summary.left < 0 ? 'rose' : 'rounds').figure,
            )}
          >
            {money(summary.left)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Money in less money out for {period.label.replace(' tax year', '')}</p>
          {flow > 0 ? (
            <div className="mt-auto pt-4">
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Money in compared with money out">
                <span className="h-full bg-(--tone-emerald-solid)" style={{ width: `${(summary.moneyIn / flow) * 100}%` }} />
                <span className="h-full bg-(--tone-rose-solid)" style={{ width: `${(summary.moneyOut / flow) * 100}%` }} />
              </div>
              <Legend
                className="mt-2"
                items={[
                  { label: 'In', tone: 'emerald' },
                  { label: 'Out', tone: 'rose' },
                ]}
              />
            </div>
          ) : null}
        </section>
        <StatTile
          label="Money in"
          value={money(summary.moneyIn)}
          tone="emerald"
          icon={TrendingUp}
          sub={`from ${summary.paymentsCount} ${summary.paymentsCount === 1 ? 'payment' : 'payments'}`}
        />
        <StatTile
          label="Money out"
          value={money(summary.moneyOut)}
          tone="rose"
          icon={TrendingDown}
          sub={`${summary.moneyOutByCategory.reduce((n, row) => n + row.count, 0)} expenses you've saved`}
        />
      </div>

      {chartRows ? (
        <LookCard title="Month by month" icon={TrendingUp} tone="indigo">
          <Legend
            className="mb-3"
            items={[
              { label: 'Money in', tone: 'emerald' },
              { label: 'Money out', tone: 'rose' },
            ]}
          />
          <div className="h-56 text-muted-foreground">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} axisLine={false} />
                <YAxis
                  width={52}
                  tick={{ fontSize: 11, fill: 'currentColor' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => `£${value}`}
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as (typeof chartRows)[number];
                    return (
                      <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-(--look-card-shadow)">
                        <p className="mb-1 font-semibold text-foreground">{row.full}</p>
                        <p className={toneClasses('emerald').text}>In {money(row.moneyIn)}</p>
                        <p className={toneClasses('rose').text}>Out {money(row.moneyOut)}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="moneyIn" fill="var(--tone-emerald-solid)" maxBarSize={18} radius={[4, 4, 0, 0]} />
                <Bar dataKey="moneyOut" fill="var(--tone-rose-solid)" maxBarSize={18} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </LookCard>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <LookCard title="Money in, by how they paid" icon={Wallet} tone="emerald">
          {summary.moneyInByMethod.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments in this period.</p>
          ) : (
            <ul className="divide-y divide-border">
              {summary.moneyInByMethod.map((row) => (
                <ShareRow
                  key={row.method}
                  icon={methodIcon(row.method)}
                  label={paymentMethodLabel(row.method)}
                  amount={row.amount}
                  share={(row.amount / inMax) * 100}
                  tone={methodTone(row.method)}
                />
              ))}
            </ul>
          )}
        </LookCard>

        <LookCard
          title="Money out, by category"
          icon={Receipt}
          tone="violet"
          aside={
            unused > 0 ? (
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="text-sm font-medium text-primary hover:underline"
              >
                {showAll ? 'Hide empty ones' : `Show all ${summary.moneyOutByCategory.length}`}
              </button>
            ) : undefined
          }
        >
          {spent.length === 0 && !showAll ? (
            <p className="text-sm text-muted-foreground">No expenses saved in this period.</p>
          ) : (
            <ul className="divide-y divide-border">
              {categories.map((row) => (
                <ShareRow
                  key={row.category}
                  icon={EXPENSE_CATEGORY_ICON[row.category]}
                  label={row.label}
                  note={
                    row.count > 0
                      ? `${row.count} ${row.count === 1 ? 'expense' : 'expenses'} · ${Math.round((row.amount / outTotal) * 100)}%`
                      : undefined
                  }
                  amount={row.amount}
                  share={(row.amount / outTotal) * 100}
                  tone="violet"
                  muted={row.count === 0}
                />
              ))}
            </ul>
          )}
        </LookCard>
      </div>

      {vat ? (
        <LookCard title="VAT" icon={Landmark} tone="slate" aside={`Estimate at ${vat.rate}%`}>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">VAT on your expenses</p>
              <Amount value={vat.vatOut} className="text-lg font-semibold" />
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">VAT in your takings (estimate)</p>
              <Amount value={vat.vatInEstimate} className="text-lg font-semibold" />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Your accountant will confirm the figures.</p>
        </LookCard>
      ) : null}

      {summary.months ? (
        <LookCard title="The numbers" icon={Scale} tone="slate">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="text-right">Left</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.months.map((m) => {
                const left = Math.round((m.moneyIn - m.moneyOut) * 100) / 100;
                return (
                  <TableRow key={`${m.year}-${m.month}`}>
                    <TableCell>
                      {monthHref ? (
                        <Link href={monthHref(m.year, m.month)} className="font-medium text-primary hover:underline">
                          {m.label}
                        </Link>
                      ) : (
                        m.label
                      )}
                    </TableCell>
                    <TableCell className="text-right"><Amount value={m.moneyIn} className="text-(--tone-emerald-text)" /></TableCell>
                    <TableCell className="text-right"><Amount value={m.moneyOut} className="text-(--tone-rose-text)" /></TableCell>
                    <TableCell className="text-right"><Amount value={left} className="font-medium" /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </LookCard>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Money in is counted on the day it arrived. Expenses count once you&apos;ve saved them.
      </p>
    </div>
  );
}

