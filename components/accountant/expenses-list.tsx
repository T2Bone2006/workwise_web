'use client';

import { useMemo, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { EmptyResults, FilterChip, SearchBox } from '@/components/accountant/list-controls';
import { formatMoney, formatShortDay } from '@/components/expenses/format';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_HMRC,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from '@/lib/books/categories';
import type { AccountantExpense } from '@/lib/data/accountant';
import { fromPence, toPence } from '@/lib/money/pence';

type Filter = 'all' | 'no-receipt';

export function ExpensesList({
  rows,
  token,
  initialFilter,
  periodLabel,
  vatRegistered,
}: {
  rows: AccountantExpense[];
  token: string;
  initialFilter: Filter;
  periodLabel: string;
  vatRegistered: boolean;
}) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [category, setCategory] = useState<ExpenseCategory | 'all'>('all');
  const [search, setSearch] = useState('');

  const noReceipt = useMemo(() => rows.filter((r) => !r.hasReceipt).length, [rows]);
  const present = useMemo(() => new Set(rows.map((r) => r.category)), [rows]);
  const needle = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === 'all' || !r.hasReceipt) &&
      (category === 'all' || r.category === category) &&
      (!needle || (r.merchant ?? '').toLowerCase().includes(needle)),
  );
  const total = fromPence(shown.reduce((s, r) => s + toPence(r.amount), 0));
  const vat = fromPence(shown.reduce((s, r) => s + toPence(r.vatAmount ?? 0), 0));

  if (rows.length === 0) return <EmptyResults>No expenses were saved in {periodLabel}.</EmptyResults>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <FilterChip active={filter === 'all' && category === 'all'} count={rows.length} onClick={() => { setFilter('all'); setCategory('all'); }}>
          All
        </FilterChip>
        <FilterChip active={filter === 'no-receipt'} count={noReceipt} onClick={() => setFilter(filter === 'no-receipt' ? 'all' : 'no-receipt')}>
          No receipt
        </FilterChip>
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value as ExpenseCategory | 'all')}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="all">All categories</option>
          {EXPENSE_CATEGORIES.filter((c) => present.has(c)).map((c) => (
            <option key={c} value={c}>{EXPENSE_CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <div className="sm:ml-auto">
          <SearchBox value={search} onChange={setSearch} placeholder="Supplier" label="Search expenses" />
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyResults>No expenses match.</EmptyResults>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {vatRegistered ? <TableHead className="text-right">VAT</TableHead> : null}
                <TableHead>Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{formatShortDay(r.spentOn)}</TableCell>
                  <TableCell>{r.merchant ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="block">{EXPENSE_CATEGORY_LABELS[r.category]}</span>
                    <span className="text-xs text-muted-foreground">{EXPENSE_CATEGORY_HMRC[r.category]}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.amount)}</TableCell>
                  {vatRegistered ? <TableCell className="text-right tabular-nums">{formatMoney(r.vatAmount)}</TableCell> : null}
                  <TableCell>
                    {r.hasReceipt ? (
                      <a
                        href={`/accountant/${token}/receipt/${r.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Paperclip className="size-4" aria-hidden="true" /> View
                      </a>
                    ) : (
                      <span className="text-xs text-amber-700 dark:text-amber-400">No receipt</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-medium">
                  {shown.length} {shown.length === 1 ? 'expense' : 'expenses'}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(total)}</TableCell>
                {vatRegistered ? <TableCell className="text-right font-medium tabular-nums">{formatMoney(vat)}</TableCell> : null}
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </div>
  );
}
