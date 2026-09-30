'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote, CreditCard, Landmark, Receipt, Wallet } from 'lucide-react';
import {
  PaymentsListFilters,
  type PaymentsWhere,
} from '@/components/payments/payments-filter-bar';
import { MoneyRow, MONEY_ACCENT } from '@/components/payments/money-row';
import type { PaymentHistoryRow } from '@/lib/data/payments/history';
import { formatGbp } from '@/lib/money/pence';
import { paymentMethodLabel } from '@/lib/payments/method-labels';

const METHODS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'direct_debit', label: 'Direct Debit' },
  { value: 'pay_by_bank', label: 'Pay by Bank' },
  { value: 'other', label: 'Other' },
];

const METHOD_ICON: Record<string, typeof Banknote> = {
  cash: Banknote,
  cheque: Receipt,
  bank_transfer: Landmark,
  card: CreditCard,
  direct_debit: Landmark,
  pay_by_bank: Landmark,
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
        <div className="rounded-2xl border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">
          {compact
            ? 'Nothing has come in lately.'
            : needle
              ? 'Nothing matches.'
              : 'Nothing has come in for these dates.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {shown.map((row) => {
            const Icon = METHOD_ICON[row.method] ?? Wallet;
            return (
              <MoneyRow
                key={row.id}
                accent={MONEY_ACCENT.received}
                icon={Icon}
                title={row.customerName}
                detail={`${formatReceived(row.receivedAt)} · ${paymentMethodLabel(row.method)}`}
                amount={formatGbp(row.amount)}
                onClick={() => router.push(`/customers/${row.customerId}`)}
              />
            );
          })}
        </ul>
      )}
      {!compact && rows.length >= HISTORY_LIMIT ? (
        <p className="text-sm text-muted-foreground">Showing the latest 200</p>
      ) : null}
    </div>
  );
}
