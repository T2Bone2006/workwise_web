'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Paperclip } from 'lucide-react';
import { EXPENSE_CATEGORY_LABELS } from '@/lib/books/categories';
import { periodParam, periodRange, type Period } from '@/lib/books/periods';
import type { ExpenseRow } from '@/lib/data/expenses';
import { formatGbp, fromPence, toPence } from '@/lib/money/pence';
import { formatMoney, formatShortDay } from '@/components/expenses/format';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type MonthPeriod = Extract<Period, { kind: 'month' }>;

function shiftMonth(p: MonthPeriod, by: number): MonthPeriod {
  const index = p.year * 12 + (p.month - 1) + by;
  return { kind: 'month', year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function ExpensesList({
  expenses,
  period,
  currentPeriod,
  vatRegistered,
  onOpen,
}: {
  expenses: ExpenseRow[];
  period: MonthPeriod;
  currentPeriod: MonthPeriod;
  vatRegistered: boolean;
  onOpen: (expense: ExpenseRow) => void;
}) {
  const router = useRouter();
  const label = periodRange(period).label;
  const atCurrent = period.year === currentPeriod.year && period.month === currentPeriod.month;
  const total = fromPence(expenses.reduce((sum, e) => sum + toPence(e.amount ?? 0), 0));

  const go = (p: MonthPeriod) => router.push(`/expenses?period=${periodParam(p)}`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label="Previous month" onClick={() => go(shiftMonth(period, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-36 text-center font-medium">{label}</span>
          <Button
            size="icon"
            variant="outline"
            aria-label="Next month"
            disabled={atCurrent}
            onClick={() => go(shiftMonth(period, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="text-base font-semibold text-foreground">{formatGbp(total, { always2dp: true })}</span> spent
        </p>
      </div>

      {expenses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing spent in {label}. Scan a receipt or add one.
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {vatRegistered ? <TableHead className="text-right">VAT</TableHead> : null}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((expense) => (
                <TableRow key={expense.id} className="cursor-pointer" onClick={() => onOpen(expense)}>
                  <TableCell className="whitespace-nowrap">{formatShortDay(expense.spentOn)}</TableCell>
                  <TableCell>{expense.merchant || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{expense.category ? EXPENSE_CATEGORY_LABELS[expense.category] : ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(expense.amount)}</TableCell>
                  {vatRegistered ? (
                    <TableCell className="text-right tabular-nums">{formatMoney(expense.vatAmount)}</TableCell>
                  ) : null}
                  <TableCell>
                    {expense.hasReceipt ? (
                      <button
                        type="button"
                        aria-label="View receipt"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(expense);
                        }}
                      >
                        <Paperclip className="size-4" />
                      </button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
