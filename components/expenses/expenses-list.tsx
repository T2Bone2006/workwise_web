'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Paperclip, Receipt } from 'lucide-react';
import { EXPENSE_CATEGORY_LABELS } from '@/lib/books/categories';
import { periodParam, periodRange, type Period } from '@/lib/books/periods';
import type { ExpenseRow } from '@/lib/data/expenses';
import { formatGbp, fromPence, toPence } from '@/lib/money/pence';
import { formatMoney, formatShortDay } from '@/components/expenses/format';
import { EmptyState, IconChip, LookCard, Tag } from '@/components/look';
import { EXPENSE_CATEGORY_ICON } from '@/components/books/category-style';
import { Button } from '@/components/ui/button';

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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-(--look-card-shadow)">
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
          <span className="text-xl font-semibold tabular-nums text-foreground">{formatGbp(total, { always2dp: true })}</span> spent
        </p>
      </div>

      {expenses.length === 0 ? (
        <EmptyState icon={Receipt} title={`Nothing spent in ${label}`} body="Scan a receipt or add an expense and it shows up here." />
      ) : (
        <LookCard>
          <ul className="divide-y divide-border">
            {expenses.map((expense) => {
              const CategoryIcon = EXPENSE_CATEGORY_ICON[expense.category ?? 'other'];
              return (
                <li key={expense.id} className="relative flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <button
                    type="button"
                    aria-label={`Open ${expense.merchant || 'expense'}`}
                    onClick={() => onOpen(expense)}
                    className="absolute inset-0 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  />
                  <span className="pointer-events-none">
                    <IconChip icon={CategoryIcon} tone="violet" />
                  </span>
                  <span className="pointer-events-none min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium tracking-tight">
                      {expense.merchant || <span className="text-muted-foreground">No supplier</span>}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                      <span>{formatShortDay(expense.spentOn)}</span>
                      {expense.category ? <Tag tone="violet">{EXPENSE_CATEGORY_LABELS[expense.category]}</Tag> : null}
                    </span>
                  </span>
                  {expense.hasReceipt ? (
                    <button
                      type="button"
                      aria-label="View receipt"
                      title="View receipt"
                      className="relative z-10 flex size-8 items-center justify-center rounded-lg text-(--tone-violet-text) transition-colors hover:bg-(--tone-violet-soft)"
                      onClick={() => onOpen(expense)}
                    >
                      <Paperclip className="size-4" />
                    </button>
                  ) : null}
                  <span className="pointer-events-none text-right">
                    <span className="block text-base font-semibold text-(--tone-rose-solid) tabular-nums">
                      {formatMoney(expense.amount)}
                    </span>
                    {vatRegistered && expense.vatAmount != null ? (
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        VAT {formatMoney(expense.vatAmount)}
                      </span>
                    ) : null}
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
