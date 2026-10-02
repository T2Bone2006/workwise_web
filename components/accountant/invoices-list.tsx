'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EmptyResults, FilterChip, SearchBox } from '@/components/accountant/list-controls';
import { InvoiceStatusBadge } from '@/components/accountant/invoice-status-badge';
import { formatMoney, formatShortDay } from '@/components/expenses/format';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AccountantInvoiceRow } from '@/lib/data/accountant';
import type { InvoiceStatusLabel } from '@/lib/invoices/status';
import { fromPence, toPence } from '@/lib/money/pence';

const STATUSES: InvoiceStatusLabel[] = ['Paid', 'Unpaid', 'Overdue', 'Cancelled'];
type Filter = 'All' | InvoiceStatusLabel;

export function InvoicesList({
  rows,
  base,
  initialStatus,
  periodLabel,
  vatRegistered,
}: {
  rows: AccountantInvoiceRow[];
  base: string;
  initialStatus: Filter;
  periodLabel: string;
  vatRegistered: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>(initialStatus);
  const [search, setSearch] = useState('');

  const counts = useMemo(() => {
    const c: Record<InvoiceStatusLabel, number> = { Paid: 0, Unpaid: 0, Overdue: 0, Cancelled: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const needle = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === 'All' || r.status === filter) &&
      (!needle || `${r.customerName} ${r.number}`.toLowerCase().includes(needle)),
  );

  // A cancelled invoice isn't money billed, so it stays out of the totals.
  const live = shown.filter((r) => r.status !== 'Cancelled');
  const sum = (pick: (r: AccountantInvoiceRow) => number) => fromPence(live.reduce((s, r) => s + toPence(pick(r)), 0));

  if (rows.length === 0) return <EmptyResults>No invoices were issued in {periodLabel}.</EmptyResults>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <FilterChip active={filter === 'All'} count={rows.length} onClick={() => setFilter('All')}>All</FilterChip>
        {STATUSES.map((s) => (
          <FilterChip key={s} active={filter === s} count={counts[s]} onClick={() => setFilter(s)}>{s}</FilterChip>
        ))}
        <div className="sm:ml-auto">
          <SearchBox value={search} onChange={setSearch} placeholder="Customer or number" label="Search invoices" />
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyResults>No invoices match.</EmptyResults>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table className="min-w-[44rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Total</TableHead>
                {vatRegistered ? <TableHead className="text-right">VAT</TableHead> : null}
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`${base}/invoices/${r.id}`)}
                >
                  <TableCell>
                    <Link
                      href={`${base}/invoices/${r.id}`}
                      className="font-medium text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.number}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatShortDay(r.issueDate)}</TableCell>
                  <TableCell>{r.customerName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.total)}</TableCell>
                  {vatRegistered ? <TableCell className="text-right tabular-nums">{formatMoney(r.vatAmount)}</TableCell> : null}
                  <TableCell className="text-right tabular-nums">{formatMoney(r.paid)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.balance)}</TableCell>
                  <TableCell><InvoiceStatusBadge status={r.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-medium">
                  Totals{filter !== 'All' || needle ? ' for what’s shown' : ''}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(sum((r) => r.total))}</TableCell>
                {vatRegistered ? (
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(sum((r) => r.vatAmount))}</TableCell>
                ) : null}
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(sum((r) => r.paid))}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(sum((r) => r.balance))}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
