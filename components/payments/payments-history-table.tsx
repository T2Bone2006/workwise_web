'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, CreditCard, Landmark, Receipt, Wallet } from 'lucide-react';
import {
  PaymentsListFilters,
  type PaymentsWhere,
} from '@/components/payments/payments-filter-bar';
import { Card, CardContent } from '@/components/ui/card';
import type { PaymentHistoryRow } from '@/lib/data/payments/history';
import { formatGbp } from '@/lib/money/pence';
import type { PaymentMethod } from '@/lib/payments/money-core';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  cheque: 'Cheque',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  other: 'Other',
};

const METHOD_ICON: Record<PaymentMethod, typeof Banknote> = {
  cash: Banknote,
  cheque: Receipt,
  bank_transfer: Landmark,
  card: CreditCard,
  other: Wallet,
};

const HISTORY_LIMIT = 200;

function formatReceived(iso: string): string {
  const day = iso.slice(0, 10);
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function PaymentsHistoryTable({
  rows,
  view,
  filters,
  compact = false,
}: {
  rows: PaymentHistoryRow[];
  view: 'received';
  filters: { from?: string; to?: string };
  compact?: boolean;
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
  const total = shown.reduce((sum, row) => sum + row.amount, 0);

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

  return (
    <div className="space-y-4">
      {view === 'received' && !compact ? (
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
      ) : null}

      {shown.length === 0 ? (
        <Card className="glass-card border-border/80">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {compact
              ? 'Nothing has come in lately.'
              : needle
                ? 'Nothing matches.'
                : 'Nothing has come in for these dates.'}
          </CardContent>
        </Card>
      ) : (
        <Card className="glass-card overflow-hidden border-border/80">
          <CardContent className="divide-y divide-border/70 p-0">
            {compact ? null : (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">Came in</h2>
                  <p className="text-xs text-muted-foreground">
                    {shown.length === 1 ? '1 payment' : `${shown.length} payments`}
                  </p>
                </div>
                <span className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                  {formatGbp(total)}
                </span>
              </div>
            )}
            {shown.map((row) => {
              const Icon = METHOD_ICON[row.method] ?? Wallet;
              return (
                <div
                  key={row.id}
                  role="link"
                  tabIndex={0}
                  className="group flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/70 dark:hover:bg-accent/40"
                  onClick={() => router.push(`/customers/${row.customerId}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      router.push(`/customers/${row.customerId}`);
                    }
                  }}
                >
                  <span className="flex min-w-0 items-center gap-3 text-left">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium group-hover:underline">{row.customerName}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {formatReceived(row.receivedAt)} · {METHOD_LABEL[row.method]}
                      </span>
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 rounded-full border border-emerald-300/70 bg-emerald-50 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-200">
                    {formatGbp(row.amount)}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
      {!compact && rows.length >= HISTORY_LIMIT ? (
        <p className="text-sm text-muted-foreground">Showing the latest 200</p>
      ) : null}
    </div>
  );
}
