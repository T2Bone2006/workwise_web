'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, PieChart, Plus, Receipt } from 'lucide-react';
import { PageTabs, StatTile } from '@/components/look';
import { EXPENSE_CATEGORY_LABELS } from '@/lib/books/categories';
import { formatGbp, fromPence, toPence } from '@/lib/money/pence';
import { periodRange } from '@/lib/books/periods';
import type { Period } from '@/lib/books/periods';
import type { ExpenseRow } from '@/lib/data/expenses';
import { ExpenseDialog, type ExpenseDialogState } from '@/components/expenses/expense-dialog';
import { ExpensesList } from '@/components/expenses/expenses-list';
import { ScanReceiptButton, type ScanOutcome } from '@/components/expenses/scan-receipt-button';
import { ToCheckList } from '@/components/expenses/to-check-list';
import { Button } from '@/components/ui/button';

type MonthPeriod = Extract<Period, { kind: 'month' }>;
export type ExpensesTab = 'expenses' | 'in-out';

export function ExpensesTabs({
  tab,
  drafts,
  expenses,
  period,
  currentPeriod,
  vatRegistered,
  inOutPanel,
}: {
  tab: ExpensesTab;
  drafts: ExpenseRow[];
  expenses: ExpenseRow[];
  period: MonthPeriod;
  currentPeriod: MonthPeriod;
  vatRegistered: boolean;
  inOutPanel: React.ReactNode;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<ExpenseDialogState | null>(null);
  // After a scan the page refreshes; once the new draft arrives in `drafts`, it opens to be checked.
  const [pendingOpen, setPendingOpen] = useState<ScanOutcome | null>(null);
  const pendingExpense = pendingOpen ? drafts.find((d) => d.id === pendingOpen.expenseId) : undefined;
  const shownDialog: ExpenseDialogState | null =
    dialog ??
    (pendingOpen && pendingExpense
      ? {
          mode: 'check',
          expense: pendingExpense,
          notice: pendingOpen.read === 'read' ? undefined : pendingOpen.read,
        }
      : null);
  const spentPence = expenses.reduce((sum, e) => sum + toPence(e.amount ?? 0), 0);
  const byCategory = new Map<string, number>();
  for (const e of expenses) {
    const key = e.category ?? 'other';
    byCategory.set(key, (byCategory.get(key) ?? 0) + toPence(e.amount ?? 0));
  }
  const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
  const monthLabel = periodRange(period).label;
  const closeDialog = () => {
    setDialog(null);
    setPendingOpen(null);
  };

  return (
    <>
      <div className="space-y-5">
        <PageTabs
          ariaLabel="Expenses"
          active={tab}
          items={[
            { key: 'expenses', label: 'Expenses', href: '/expenses', count: drafts.length, countTone: 'amber' },
            { key: 'in-out', label: 'In & out', href: '/expenses?tab=in-out' },
          ]}
        />
        {tab === 'expenses' ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label={`Spent · ${monthLabel}`}
                value={formatGbp(fromPence(spentPence), { always2dp: true })}
                tone="rose"
                icon={Receipt}
                sub={expenses.length === 1 ? '1 expense saved' : `${expenses.length} expenses saved`}
              />
              <StatTile
                label="Receipts to check"
                value={String(drafts.length)}
                tone={drafts.length > 0 ? 'amber' : 'emerald'}
                icon={ClipboardCheck}
                sub={drafts.length > 0 ? 'Check each one and press Save' : 'Nothing waiting for you'}
              />
              <StatTile
                label="Biggest category"
                value={top ? formatGbp(fromPence(top[1]), { always2dp: true }) : '—'}
                tone="violet"
                icon={PieChart}
                sub={top ? EXPENSE_CATEGORY_LABELS[top[0] as keyof typeof EXPENSE_CATEGORY_LABELS] ?? 'Other' : 'Nothing spent yet'}
              />
            </div>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
              <div className="min-w-0 flex-1">
                <ScanReceiptButton
                  onScanned={(last) => {
                    setPendingOpen(last);
                    router.refresh();
                  }}
                />
              </div>
              <Button variant="outline" className="h-auto min-h-14 rounded-2xl px-5 lg:self-stretch" onClick={() => setDialog({ mode: 'add' })}>
                <Plus className="size-4" /> Add an expense
              </Button>
            </div>
            <ToCheckList drafts={drafts} onCheck={(expense) => setDialog({ mode: 'check', expense })} />
            <ExpensesList
              expenses={expenses}
              period={period}
              currentPeriod={currentPeriod}
              vatRegistered={vatRegistered}
              onOpen={(expense) => setDialog({ mode: 'edit', expense })}
            />
          </div>
        ) : (
          inOutPanel
        )}
      </div>

      <ExpenseDialog state={shownDialog} vatRegistered={vatRegistered} onClose={closeDialog} />
    </>
  );
}
