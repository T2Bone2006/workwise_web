'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchX, Wallet } from 'lucide-react';
import { EmptyState, IconChip, LookCard, toneClasses } from '@/components/look';
import { METHODS, methodIcon, methodTone } from '@/components/payments/method-style';
import { PaymentFeed } from '@/components/payments/payment-feed';
import {
  PaymentsListFilters,
  type PaymentsWhere,
} from '@/components/payments/payments-filter-bar';
import type { PaymentHistoryRow } from '@/lib/data/payments/history';
import { formatGbp } from '@/lib/money/pence';
import { paymentMethodLabel } from '@/lib/payments/method-labels';
import { cn } from '@/lib/utils';

const HISTORY_LIMIT = 200;

/** Money that has come in: how it arrived (the bar), then every payment by day. */
export function PaymentsHistoryTable({
  rows,
  filters,
  today,
}: {
  rows: PaymentHistoryRow[];
  filters: { from?: string; to?: string };
  today: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [wheres, setWheres] = useState<PaymentsWhere[]>([]);
  const needle = search.trim().toLowerCase();
  const active = rows.filter((row) => row.status === 'active');
  const shown = active.filter((row) => {
    if (needle && !row.customerName.toLowerCase().includes(needle)) return false;
    for (const where of wheres) {
      if (!where.field || !where.value) continue;
      if (where.field === 'customer' && row.customerName !== where.value) return false;
      if (where.field === 'method' && row.method !== where.value) return false;
    }
    return true;
  });
  const customerOptions = [...new Set(active.map((row) => row.customerName))].sort().map((name) => ({
    value: name,
    label: name,
  }));
  const whereActive = wheres.some((where) => where.field && where.value);

  const pushDates = (dateFrom?: string, dateTo?: string) => {
    const params = new URLSearchParams();
    params.set('view', 'received');
    if (!dateFrom && !dateTo) params.set('all', '1');
    else {
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
    }
    router.push(`/payments?${params.toString()}`);
  };

  const total = shown.reduce((sum, row) => sum + row.amount, 0);
  // Cash, cheque and other are all slate, so they share one slice: a colour never means two things.
  const groupOf = (method: string) => (['cash', 'cheque', 'other'].includes(method) ? 'cash' : method);
  const mix = [...new Set(shown.map((row) => groupOf(row.method)))]
    .map((group) => {
      const inGroup = shown.filter((row) => groupOf(row.method) === group);
      return {
        value: group,
        label: group === 'cash' ? 'Cash, cheque, other' : paymentMethodLabel(group),
        count: inGroup.length,
        amount: inGroup.reduce((sum, row) => sum + row.amount, 0),
      };
    })
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  return (
    <div className="space-y-4">
      {shown.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Came in</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-(--tone-emerald-solid) tabular-nums sm:text-[28px]">
                {formatGbp(total)}
              </p>
            </div>
            <p className="pb-1 text-sm text-muted-foreground">
              from {shown.length === 1 ? '1 payment' : `${shown.length} payments`}, by how they paid
            </p>
          </div>
          <div className="mt-3.5 flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Money in, by how it was paid">
            {mix.map((item) => (
              <span
                key={item.value}
                className={cn('h-full min-w-1.5', toneClasses(methodTone(item.value)).solid)}
                style={{ width: `${(item.amount / total) * 100}%` }}
              />
            ))}
          </div>
          <ul className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {mix.map((item) => (
              <li key={item.value} className="flex items-center gap-2.5">
                <IconChip icon={methodIcon(item.value)} tone={methodTone(item.value)} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {item.count === 1 ? '1 payment' : `${item.count} payments`}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{formatGbp(item.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PaymentsListFilters
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Customer name…"
        dateLabel="Received"
        dateFrom={filters.from}
        dateTo={filters.to}
        onDateChange={({ date_from, date_to }) => pushDates(date_from, date_to)}
        fields={[
          { key: 'customer', label: 'Customer', options: customerOptions },
          {
            key: 'method',
            label: 'How they paid',
            options: METHODS.map((opt) => ({ value: opt.value, label: opt.label })),
          },
        ]}
        wheres={wheres}
        onWheresChange={setWheres}
        hasFilters={needle.length > 0 || Boolean(filters.from || filters.to) || whereActive}
        onClear={() => {
          setSearch('');
          setWheres([]);
          pushDates();
        }}
      />

      {shown.length === 0 ? (
        <EmptyState
          icon={needle ? SearchX : Wallet}
          title={needle ? 'Nothing matches' : 'Nothing has come in for these dates'}
          body={needle ? 'Try a different name or clear the filters.' : 'Try a wider date range.'}
        />
      ) : (
        <LookCard>
          <PaymentFeed rows={shown} today={today} />
        </LookCard>
      )}
      {rows.length >= HISTORY_LIMIT ? (
        <p className="text-sm text-muted-foreground">Showing the latest 200</p>
      ) : null}
    </div>
  );
}
