'use client';

import type { ExpenseRow } from '@/lib/data/expenses';
import { formatMoney, formatShortDay } from '@/components/expenses/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function describe(expense: ExpenseRow): string {
  const day = formatShortDay(expense.spentOn);
  const created = formatShortDay(expense.createdAt.slice(0, 10));
  if (expense.amount == null && !expense.merchant) {
    return `Receipt from ${day || created} — couldn't read it`;
  }
  return [expense.merchant || 'Receipt', formatMoney(expense.amount), day].filter(Boolean).join(' · ');
}

export function ToCheckList({
  drafts,
  onCheck,
}: {
  drafts: ExpenseRow[];
  onCheck: (expense: ExpenseRow) => void;
}) {
  if (drafts.length === 0) return null;
  return (
    <Card className="border-amber-300/70 bg-amber-50/50 dark:border-amber-400/30 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle>To check ({drafts.length})</CardTitle>
        <p className="text-sm text-muted-foreground">
          We read these from your receipts. Check each one and press Save — they don&apos;t count until you do.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {drafts.map((expense) => (
          <div key={expense.id} className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2">
            <span className="text-sm">{describe(expense)}</span>
            <Button size="sm" variant="outline" onClick={() => onCheck(expense)}>
              Check
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
