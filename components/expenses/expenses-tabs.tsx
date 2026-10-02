'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { Period } from '@/lib/books/periods';
import type { ExpenseRow } from '@/lib/data/expenses';
import { ExpenseDialog, type ExpenseDialogState } from '@/components/expenses/expense-dialog';
import { ExpensesList } from '@/components/expenses/expenses-list';
import { ScanReceiptButton, type ScanOutcome } from '@/components/expenses/scan-receipt-button';
import { ToCheckList } from '@/components/expenses/to-check-list';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  const closeDialog = () => {
    setDialog(null);
    setPendingOpen(null);
  };

  return (
    <>
      <Tabs
        value={tab}
        onValueChange={(next) => router.push(next === 'in-out' ? '/expenses?tab=in-out' : '/expenses')}
      >
        <TabsList>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="in-out">In &amp; out</TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="space-y-5 pt-2">
          <div className="space-y-3">
            <ScanReceiptButton
              onScanned={(last) => {
                setPendingOpen(last);
                router.refresh();
              }}
            />
            <Button variant="outline" onClick={() => setDialog({ mode: 'add' })}>
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
        </TabsContent>

        <TabsContent value="in-out" className="pt-2">
          {inOutPanel}
        </TabsContent>
      </Tabs>

      <ExpenseDialog state={shownDialog} vatRegistered={vatRegistered} onClose={closeDialog} />
    </>
  );
}
