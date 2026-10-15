'use client';

import { useMemo, useState } from 'react';
import { EmptyResults, FilterChip, SearchBox } from '@/components/accountant/list-controls';
import { formatMoney, formatShortDay } from '@/components/expenses/format';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AccountantPayment } from '@/lib/data/accountant';
import { fromPence, toPence } from '@/lib/money/pence';
import { paymentMethodLabel } from '@/lib/payments/method-labels';

const netPence = (p: AccountantPayment) => Math.max(0, toPence(p.amount) - toPence(p.refunded));

export function PaymentsList({
  rows,
  initialFilter,
  periodLabel,
}: {
  rows: AccountantPayment[];
  initialFilter: 'all' | 'refunded';
  periodLabel: string;
}) {
  const [method, setMethod] = useState<string>('all');
  const [refundedOnly, setRefundedOnly] = useState(initialFilter === 'refunded');
  const [search, setSearch] = useState('');

  const methods = useMemo(() => [...new Set(rows.map((r) => r.method))], [rows]);
  const refundedCount = useMemo(() => rows.filter((r) => r.refunded > 0).length, [rows]);
  const needle = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (method === 'all' || r.method === method) &&
      (!refundedOnly || r.refunded > 0) &&
      (!needle || r.customerName.toLowerCase().includes(needle)),
  );
  const gross = fromPence(shown.reduce((s, r) => s + toPence(r.amount), 0));
  const refunded = fromPence(shown.reduce((s, r) => s + toPence(r.refunded), 0));
  const net = fromPence(shown.reduce((s, r) => s + netPence(r), 0));

  if (rows.length === 0) return <EmptyResults>No payments were received in {periodLabel}.</EmptyResults>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <FilterChip active={method === 'all' && !refundedOnly} count={rows.length} onClick={() => { setMethod('all'); setRefundedOnly(false); }}>
          All
        </FilterChip>
        {methods.map((m) => (
          <FilterChip key={m} active={method === m} onClick={() => setMethod(method === m ? 'all' : m)}>
            {paymentMethodLabel(m)}
          </FilterChip>
        ))}
        {refundedCount > 0 ? (
          <FilterChip active={refundedOnly} count={refundedCount} onClick={() => setRefundedOnly(!refundedOnly)}>
            Refunded
          </FilterChip>
        ) : null}
        <div className="sm:ml-auto">
          <SearchBox value={search} onChange={setSearch} placeholder="Customer" label="Search payments" />
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyResults>No payments match.</EmptyResults>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table className="min-w-[38rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>How they paid</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Refunded</TableHead>
                <TableHead className="text-right">Counted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{formatShortDay(r.receivedOn)}</TableCell>
                  <TableCell>{r.customerName}</TableCell>
                  <TableCell>{paymentMethodLabel(r.method)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">
                    {r.refunded > 0 ? formatMoney(r.refunded) : ''}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(fromPence(netPence(r)))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-medium">
                  {shown.length} {shown.length === 1 ? 'payment' : 'payments'}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(gross)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums text-destructive">{refunded > 0 ? formatMoney(refunded) : ''}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(net)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
