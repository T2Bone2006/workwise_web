'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, Phone } from 'lucide-react';
import { CopyPayLinkButton } from '@/components/payments/copy-pay-link-button';
import {
  PaymentsListFilters,
  type PaymentsWhere,
} from '@/components/payments/payments-filter-bar';
import { RecordPaymentDialog } from '@/components/payments/record-payment-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { OwedCustomerRow } from '@/lib/data/payments/owed';
import { formatGbp } from '@/lib/money/pence';
import { diffDays } from '@/lib/rounds/dates';

function formatSince(ymd: string | null): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function waitingLabel(oldest: string | null, today: string): string {
  if (!oldest) return '—';
  const days = diffDays(oldest, today);
  if (days < 0) return formatSince(oldest);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export function OwedTable({ rows, today }: { rows: OwedCustomerRow[]; today: string }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [wheres, setWheres] = useState<PaymentsWhere[]>([]);
  const needle = search.trim().toLowerCase();
  const owingAll = rows.filter((row) => row.owedAmount > 0);
  const owing = owingAll.filter((row) => {
    if (needle) {
      const haystack = [row.name, row.phone, row.email].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    const since = row.oldestUnpaidDate?.slice(0, 10) ?? '';
    if (dateFrom && (!since || since < dateFrom)) return false;
    if (dateTo && (!since || since > dateTo)) return false;
    for (const where of wheres) {
      if (!where.field || !where.value) continue;
      if (where.field === 'customer' && row.name !== where.value) return false;
      if (where.field === 'visits' && String(row.unpaidVisitCount) !== where.value) return false;
    }
    return true;
  });
  const customerOptions = [...new Set(owingAll.map((row) => row.name))].sort().map((name) => ({
    value: name,
    label: name,
  }));
  const visitOptions = [...new Set(owingAll.map((row) => row.unpaidVisitCount))]
    .sort((a, b) => a - b)
    .map((count) => ({
      value: String(count),
      label: count === 1 ? '1 visit' : `${count} visits`,
    }));
  const whereActive = wheres.some((where) => where.field && where.value);
  const [payingId, setPayingId] = useState<string | null>(null);
  const paying = owing.find((row) => row.customerId === payingId) ?? null;

  const filters = (
    <PaymentsListFilters
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Name, phone, email…"
      dateLabel="Owed since"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateChange={({ date_from, date_to }) => {
        setDateFrom(date_from);
        setDateTo(date_to);
      }}
      fields={[
        { key: 'customer', label: 'Customer', options: customerOptions },
        { key: 'visits', label: 'Visits', options: visitOptions },
      ]}
      wheres={wheres}
      onWheresChange={setWheres}
      hasFilters={needle.length > 0 || Boolean(dateFrom || dateTo) || whereActive}
      onClear={() => {
        setSearch('');
        setDateFrom(undefined);
        setDateTo(undefined);
        setWheres([]);
      }}
    />
  );

  if (owingAll.length === 0) {
    return (
      <Card className="glass-card border-border/80">
        <CardContent className="flex min-h-[180px] flex-col items-center justify-center p-8 text-center">
          <p className="text-sm font-medium text-foreground">Nobody is overdue</p>
          <p className="mt-1 text-sm text-muted-foreground">Every customer is paid up.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {filters}
      {owing.length === 0 ? (
        <Card className="glass-card border-border/80">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nothing matches.
          </CardContent>
        </Card>
      ) : (
      <Card className="glass-card border-border/80">
        <CardContent className="divide-y divide-border/70 p-0">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Chase these</h2>
              <p className="text-xs text-muted-foreground">Longest waiting first.</p>
            </div>
            <span className="text-lg font-semibold tabular-nums text-rose-700 dark:text-rose-300">
              {formatGbp(owing.reduce((sum, row) => sum + row.owedAmount, 0))}
            </span>
          </div>
          {owing.map((row) => (
            <div key={row.customerId} className="group flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/70 dark:hover:bg-accent/40">
              <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                onClick={() => router.push(`/customers/${row.customerId}`)}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-300">
                  <CircleAlert className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium group-hover:underline">{row.name}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {waitingLabel(row.oldestUnpaidDate, today)}
                    {' · '}
                    since {formatSince(row.oldestUnpaidDate)}
                    {' · '}
                    {row.unpaidVisitCount === 1 ? '1 visit' : `${row.unpaidVisitCount} visits`}
                  </span>
                </span>
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex shrink-0 rounded-full border border-rose-300/70 bg-rose-50 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-rose-900 dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-200">
                  {formatGbp(row.owedAmount)}
                </span>
                {row.phone ? (
                  <a
                    href={`tel:${row.phone}`}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <Phone className="size-3.5" />
                    Call
                  </a>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => setPayingId(row.customerId)}>
                  Mark as paid
                </Button>
                <CopyPayLinkButton customerId={row.customerId} available />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      )}
      {paying ? (
        <RecordPaymentDialog
          key={paying.customerId}
          customerId={paying.customerId}
          defaultAmount={paying.owedAmount}
          unpaidVisits={[]}
          open
          onOpenChange={(open) => {
            if (!open) setPayingId(null);
          }}
        />
      ) : null}
    </div>
  );
}
