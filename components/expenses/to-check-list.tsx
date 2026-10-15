'use client';

import type { ExpenseRow } from '@/lib/data/expenses';
import { formatMoney, formatShortDay } from '@/components/expenses/format';
import { Button } from '@/components/ui/button';
import { ClipboardCheck, FileQuestion, ReceiptText } from 'lucide-react';
import { IconChip, LookCard, Tag } from '@/components/look';

/** What was read off the receipt, in the order you check it: who, how much, when. */
function summary(expense: ExpenseRow): { title: string; detail: string; unread: boolean } {
  const day = formatShortDay(expense.spentOn);
  const created = formatShortDay(expense.createdAt.slice(0, 10));
  if (expense.amount == null && !expense.merchant) {
    return { title: "Couldn't read this receipt", detail: `Added ${day || created}. Open it and type the details in.`, unread: true };
  }
  return {
    title: expense.merchant || 'Receipt',
    detail: [day, expense.amount == null ? 'amount missing' : null].filter(Boolean).join(' · '),
    unread: false,
  };
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
    <LookCard
      className="border-(--tone-amber-line)"
      title="Receipts to check"
      icon={ClipboardCheck}
      tone="amber"
      aside={<Tag tone="amber">{drafts.length} waiting</Tag>}
    >
      <p className="-mt-1 mb-3 text-sm text-muted-foreground">
        WorkWise read these from your photos. Check each one and press Save. They don&apos;t count until you do.
      </p>
      <ul className="grid gap-2.5 md:grid-cols-2">
        {drafts.map((expense) => {
          const read = summary(expense);
          return (
            <li
              key={expense.id}
              className="flex items-center gap-3 rounded-xl border border-(--tone-amber-line) bg-(--tone-amber-soft) px-3.5 py-3"
            >
              <IconChip icon={read.unread ? FileQuestion : ReceiptText} tone={read.unread ? 'slate' : 'violet'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{read.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{read.detail}</span>
              </span>
              {expense.amount != null ? (
                <span className="text-base font-semibold tabular-nums">{formatMoney(expense.amount)}</span>
              ) : null}
              <Button size="sm" variant="outline" className="bg-card" onClick={() => onCheck(expense)}>
                Check and save
              </Button>
            </li>
          );
        })}
      </ul>
    </LookCard>
  );
}
