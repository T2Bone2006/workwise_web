'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import {
  PaymentsListFilters,
  type PaymentsWhere,
} from '@/components/payments/payments-filter-bar';
import { MoneyRow, MONEY_ACCENT, type MoneyAccent } from '@/components/payments/money-row';
import { Card, CardContent } from '@/components/ui/card';
import type { InvoiceRecord } from '@/lib/data/payments/invoices';
import { invoiceStatus } from '@/lib/invoices/status';
import { formatGbp } from '@/lib/money/pence';

export { invoiceStatus };

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const INVOICE_ACCENT: Record<ReturnType<typeof invoiceStatus>, MoneyAccent> = {
  Paid: MONEY_ACCENT.received,
  Overdue: MONEY_ACCENT.overdue,
  Unpaid: MONEY_ACCENT.unpaid,
  Cancelled: MONEY_ACCENT.quiet,
};

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
        <ul className="space-y-3">
          {filtered.map((invoice) => {
            const status = invoiceStatus(invoice);
            const owed = invoice.status !== 'void' && invoice.balanceDue > 0;
            return (
              <MoneyRow
                key={invoice.id}
                accent={INVOICE_ACCENT[status]}
                icon={FileText}
                title={invoice.billTo.name}
                detail={`${invoice.number} · ${formatDay(invoice.issueDate)}`}
                amount={formatGbp(owed ? invoice.balanceDue : invoice.total)}
                status={status}
                onClick={() => router.push(`/payments/invoices/${invoice.id}`)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
