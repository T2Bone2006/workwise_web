'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import {
  PaymentsListFilters,
  type PaymentsWhere,
} from '@/components/payments/payments-filter-bar';
import { Card, CardContent } from '@/components/ui/card';
import type { InvoiceRecord } from '@/lib/data/payments/invoices';
import { formatGbp } from '@/lib/money/pence';

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function invoiceStatus(invoice: InvoiceRecord): 'Paid' | 'Overdue' | 'Unpaid' | 'Cancelled' {
  if (invoice.status === 'void') return 'Cancelled';
  if (invoice.balanceDue <= 0) return 'Paid';
  if (invoice.isOverdue) return 'Overdue';
  return 'Unpaid';
}

const PILL =
  'inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-sm font-semibold tabular-nums';

function amountPill(status: ReturnType<typeof invoiceStatus>, amount: string) {
  if (status === 'Paid') {
    return (
      <span className={`${PILL} border-emerald-300/70 bg-emerald-50 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/15 dark:text-emerald-200`}>
        {amount}
      </span>
    );
  }
  if (status === 'Cancelled') {
    return (
      <span className={`${PILL} border-border bg-muted text-muted-foreground line-through`}>
        {amount}
      </span>
    );
  }
  return (
    <span className={`${PILL} border-rose-300/70 bg-rose-50 text-rose-900 dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-200`}>
      {amount}
    </span>
  );
}

export function InvoicesTable({ rows }: { rows: InvoiceRecord[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [wheres, setWheres] = useState<PaymentsWhere[]>([]);
  const needle = search.trim().toLowerCase();

  const filtered = rows.filter((invoice) => {
    if (needle && !`${invoice.billTo.name} ${invoice.number}`.toLowerCase().includes(needle)) {
      return false;
    }
    if (dateFrom && invoice.issueDate < dateFrom) return false;
    if (dateTo && invoice.issueDate > dateTo) return false;
    for (const where of wheres) {
      if (!where.field || !where.value) continue;
      if (where.field === 'status' && invoiceStatus(invoice) !== where.value) return false;
      if (where.field === 'customer' && invoice.billTo.name !== where.value) return false;
    }
    return true;
  });
  const customerOptions = [...new Set(rows.map((invoice) => invoice.billTo.name))].sort().map((name) => ({
    value: name,
    label: name,
  }));
  const whereActive = wheres.some((where) => where.field && where.value);

  const filters = (
    <PaymentsListFilters
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Customer or invoice number…"
      dateLabel="Issued"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateChange={({ date_from, date_to }) => {
        setDateFrom(date_from);
        setDateTo(date_to);
      }}
      fields={[
        {
          key: 'status',
          label: 'Status',
          options: ['Unpaid', 'Overdue', 'Paid', 'Cancelled'].map((status) => ({
            value: status,
            label: status,
          })),
        },
        { key: 'customer', label: 'Customer', options: customerOptions },
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

  if (rows.length === 0) {
    return (
      <Card className="glass-card border-border/80">
        <CardContent className="flex min-h-[180px] flex-col items-center justify-center p-8 text-center">
          <p className="text-sm font-medium text-foreground">No invoices yet</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Turn on &apos;Send an invoice after each visit&apos; for a customer, or use Send invoice on their page.
          </p>
        </CardContent>
      </Card>
    );
  }

  const openBalance = filtered.reduce(
    (sum, invoice) => (invoice.status === 'void' ? sum : sum + invoice.balanceDue),
    0,
  );

  return (
    <div className="space-y-3">
      {filters}
      {filtered.length === 0 ? (
        <Card className="glass-card border-border/80">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nothing matches.
          </CardContent>
        </Card>
      ) : (
    <Card className="glass-card overflow-hidden border-border/80">
      <CardContent className="divide-y divide-border/70 p-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Invoices</h2>
            <p className="text-xs text-muted-foreground">
              {filtered.length === 1 ? '1 invoice' : `${filtered.length} invoices`}
            </p>
          </div>
          <span
            className={
              openBalance > 0
                ? 'text-lg font-semibold tabular-nums text-rose-700 dark:text-rose-300'
                : 'text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-300'
            }
          >
            {formatGbp(openBalance)}
          </span>
        </div>
        {filtered.map((invoice) => {
          const status = invoiceStatus(invoice);
          const owed = invoice.status !== 'void' && invoice.balanceDue > 0;
          const iconClass = owed
            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
            : status === 'Paid'
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
              : 'bg-muted text-muted-foreground';
          return (
            <button
              key={invoice.id}
              type="button"
              className="group flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/70 dark:hover:bg-accent/40"
              onClick={() => router.push(`/payments/invoices/${invoice.id}`)}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${iconClass}`}>
                  <FileText className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium group-hover:underline">{invoice.billTo.name}</span>
                  <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                    {invoice.number}
                    {' · '}
                    {formatDay(invoice.issueDate)}
                    {' · '}
                    {status}
                  </span>
                </span>
              </span>
              {amountPill(status, formatGbp(owed ? invoice.balanceDue : invoice.total))}
            </button>
          );
        })}
      </CardContent>
    </Card>
      )}
    </div>
  );
}
