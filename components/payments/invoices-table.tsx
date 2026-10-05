'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, SearchX } from 'lucide-react';
import { Avatar, EmptyState, LookCard, Tag, type Tone } from '@/components/look';
import { FilterChips, type FilterChip } from '@/components/payments/filter-chips';
import {
  PaymentsListFilters,
  type PaymentsWhere,
} from '@/components/payments/payments-filter-bar';
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

type InvoiceStatus = ReturnType<typeof invoiceStatus>;

const INVOICE_STATUS_TONE: Record<InvoiceStatus, Tone> = {
  Paid: 'emerald',
  Overdue: 'amber',
  Unpaid: 'rounds',
  Cancelled: 'slate',
};

const STATUSES: InvoiceStatus[] = ['Unpaid', 'Overdue', 'Paid', 'Cancelled'];

export function InvoicesTable({ rows }: { rows: InvoiceRecord[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [wheres, setWheres] = useState<PaymentsWhere[]>([]);
  const [statusTab, setStatusTab] = useState<InvoiceStatus | 'all'>('all');
  const needle = search.trim().toLowerCase();

  const filtered = rows.filter((invoice) => {
    if (statusTab !== 'all' && invoiceStatus(invoice) !== statusTab) return false;
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
      <EmptyState
        icon={FileText}
        title="No invoices yet"
        body="Turn on 'Send an invoice after each visit' for a customer, or use Send invoice on their page."
      />
    );
  }

  const amountOf = (invoice: InvoiceRecord) =>
    invoice.status !== 'void' && invoice.balanceDue > 0 ? invoice.balanceDue : invoice.total;
  const byStatus = STATUSES.map((status) => {
    const inStatus = rows.filter((invoice) => invoiceStatus(invoice) === status);
    return {
      status,
      count: inStatus.length,
      amount: inStatus.reduce((sum, invoice) => sum + amountOf(invoice), 0),
    };
  });
  const chips: FilterChip<InvoiceStatus | 'all'>[] = [
    {
      key: 'all',
      label: 'All invoices',
      detail: `${rows.length} · ${formatGbp(rows.filter((r) => r.status !== 'void').reduce((sum, r) => sum + r.total, 0))}`,
    },
    ...byStatus
      .filter((item) => item.count > 0)
      .map((item) => ({
        key: item.status,
        label: item.status,
        tone: INVOICE_STATUS_TONE[item.status],
        detail: `${item.count} · ${formatGbp(item.amount)}`,
      })),
  ];

  return (
    <div className="space-y-4">
      <FilterChips
        ariaLabel="Invoice status"
        chips={chips}
        value={statusTab}
        onChange={(key) => setStatusTab(key === statusTab ? 'all' : key)}
      />
      {filters}
      {filtered.length === 0 ? (
        <EmptyState icon={SearchX} title="Nothing matches" body="Try a different name or clear the filters." />
      ) : (
        <LookCard>
          <ul className="divide-y divide-border">
            {filtered.map((invoice) => {
              const status = invoiceStatus(invoice);
              const tone = INVOICE_STATUS_TONE[status];
              return (
                <li key={invoice.id} className="relative flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0 sm:flex-nowrap sm:gap-4">
                  <button
                    type="button"
                    aria-label={`Open invoice ${invoice.number}`}
                    onClick={() => router.push(`/payments/invoices/${invoice.id}`)}
                    className="absolute inset-0 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  />
                  <span className="pointer-events-none flex min-w-0 flex-1 basis-52 items-center gap-3">
                    <Avatar name={invoice.billTo.name} tone={status === 'Cancelled' ? 'slate' : tone === 'rounds' ? 'slate' : tone} />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium tracking-tight">{invoice.billTo.name}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                        <span className="font-medium tabular-nums">{invoice.number}</span> · issued {formatDay(invoice.issueDate)}
                        {status === 'Paid' || status === 'Cancelled' ? '' : ` · due ${formatDay(invoice.dueDate)}`}
                      </span>
                    </span>
                  </span>
                  <span className="pointer-events-none ml-auto flex items-center gap-3">
                    <Tag tone={tone}>{status}</Tag>
                    <span
                      className={
                        status === 'Cancelled'
                          ? 'w-20 text-right text-base font-semibold text-muted-foreground tabular-nums line-through'
                          : 'w-20 text-right text-base font-semibold tabular-nums'
                      }
                    >
                      {formatGbp(amountOf(invoice))}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </LookCard>
      )}
    </div>
  );
}
