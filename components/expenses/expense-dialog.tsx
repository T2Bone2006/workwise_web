'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { addExpense, deleteExpense, saveExpense } from '@/lib/actions/expenses';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@/lib/books/categories';
import type { ExpenseRow } from '@/lib/data/expenses';
import { formatGbp, parseMoneyInput } from '@/lib/money/pence';
import { todayInLondon } from '@/lib/rounds/dates';
import { ReceiptViewer } from '@/components/expenses/receipt-viewer';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export type ExpenseDialogState =
  | { mode: 'add' }
  | { mode: 'check' | 'edit'; expense: ExpenseRow; notice?: 'not_a_receipt' | 'unreadable' };

const NOTICES = {
  not_a_receipt: "That doesn't look like a receipt — fill it in or delete it.",
  unreadable: "We couldn't read it — please fill it in.",
} as const;

export function ExpenseDialog({
  state,
  vatRegistered,
  onClose,
}: {
  state: ExpenseDialogState | null;
  vatRegistered: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={state != null} onOpenChange={(open) => !open && onClose()}>
      {state ? (
        <DialogContent
          className={state.mode !== 'add' && state.expense.hasReceipt ? 'sm:max-w-3xl' : 'sm:max-w-md'}
        >
          <ExpenseForm state={state} vatRegistered={vatRegistered} onClose={onClose} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function ExpenseForm({
  state,
  vatRegistered,
  onClose,
}: {
  state: ExpenseDialogState;
  vatRegistered: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const expense = state.mode === 'add' ? null : state.expense;
  const today = todayInLondon();

  // Mounted fresh each time the dialog opens, so one id per opening: a retried Save can't double up.
  const [clientMutationId] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState(expense?.spentOn ?? (state.mode === 'add' ? today : ''));
  const [merchant, setMerchant] = useState(expense?.merchant ?? '');
  const [category, setCategory] = useState<ExpenseCategory | ''>(expense?.category ?? '');
  const [amount, setAmount] = useState(expense?.amount != null ? String(expense.amount) : '');
  const [vat, setVat] = useState(expense?.vatAmount != null ? String(expense.vatAmount) : '');
  const [note, setNote] = useState(expense?.note ?? '');
  const [pending, setPending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Typing or choosing anything clears an old error, so "Pick a category" doesn't linger once fixed.
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setError(null);
      set(value);
    };

  const title = state.mode === 'add' ? 'Add an expense' : state.mode === 'check' ? 'Check this expense' : 'Edit expense';
  const notice = state.mode === 'check' ? state.notice : undefined;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (pending) return;

    const amountNum = parseMoneyInput(amount);
    if (amountNum == null || amountNum <= 0) return setError('Enter the amount');
    if (!category) return setError('Pick a category');
    if (!date) return setError('Enter the date');
    if (date > today) return setError('That date is in the future');

    // Not VAT registered: the field is hidden, but VAT already recorded is kept as it was.
    let vatNum: number | null = expense?.vatAmount ?? null;
    if (vatRegistered) {
      if (vat.trim() === '') vatNum = null;
      else {
        const parsed = parseMoneyInput(vat);
        if (parsed == null) return setError('Enter the VAT as a number, or leave it blank');
        vatNum = parsed;
      }
    }

    const fields = { spentOn: date, merchant, category, amount: amountNum, vatAmount: vatNum, note };
    setError(null);
    setPending(true);
    const result =
      state.mode === 'add'
        ? await addExpense({ ...fields, clientMutationId })
        : await saveExpense({ ...fields, expenseId: state.expense.id });
    setPending(false);

    if (!result.success) {
      setError(result.error);
      if (result.error === 'This expense no longer exists.') router.refresh();
      return;
    }
    toast.success(`${formatGbp(amountNum, { always2dp: true })} saved`);
    onClose();
    router.refresh();
  };

  const remove = async () => {
    if (!expense || pending) return;
    setPending(true);
    const result = await deleteExpense({ expenseId: expense.id });
    setPending(false);
    if (!result.success) {
      setError(result.error);
      if (result.error === 'This expense no longer exists.') router.refresh();
      return;
    }
    toast.success('Expense deleted');
    onClose();
    router.refresh();
  };

  const form = (
    <form onSubmit={submit} className="space-y-3">
      {notice ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{NOTICES[notice]}</p> : null}
      {state.mode === 'check' && expense?.aiConfidence != null && !notice ? (
        <p className="text-sm text-muted-foreground">Read by AI — please check.</p>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="expense-date">Date</Label>
        <Input id="expense-date" type="date" max={today} value={date} onChange={(e) => edit(setDate)(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="expense-merchant">Supplier</Label>
        <Input id="expense-merchant" maxLength={120} value={merchant} onChange={(e) => edit(setMerchant)(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>Category</Label>
        <Select value={category || undefined} onValueChange={(v) => edit(setCategory)(v as ExpenseCategory)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {EXPENSE_CATEGORIES.map((key) => (
              <SelectItem key={key} value={key}>
                {EXPENSE_CATEGORY_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={vatRegistered ? 'grid grid-cols-2 gap-3' : ''}>
        <div className="space-y-1">
          <Label htmlFor="expense-amount">Amount (£)</Label>
          <Input
            id="expense-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => edit(setAmount)(e.target.value)}
          />
        </div>
        {vatRegistered ? (
          <div className="space-y-1">
            <Label htmlFor="expense-vat">VAT (£)</Label>
            <Input id="expense-vat" inputMode="decimal" value={vat} onChange={(e) => edit(setVat)(e.target.value)} />
          </div>
        ) : null}
      </div>
      {vatRegistered ? (
        <p className="-mt-1 text-xs text-muted-foreground">Leave VAT blank if there&apos;s no VAT.</p>
      ) : expense?.vatAmount != null ? (
        <p className="-mt-1 text-xs text-muted-foreground">
          VAT {formatGbp(expense.vatAmount, { always2dp: true })} recorded
        </p>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="expense-note">Note</Label>
        <Textarea id="expense-note" rows={2} maxLength={500} value={note} onChange={(e) => edit(setNote)(e.target.value)} />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {confirmingDelete ? (
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm">Delete this expense? The receipt photo is deleted too.</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmingDelete(false)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Delete
            </Button>
          </div>
        </DialogFooter>
      ) : (
        <DialogFooter className="sm:justify-between">
          {expense ? (
            <Button type="button" variant="ghost" className="text-destructive" disabled={pending} onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
          </div>
        </DialogFooter>
      )}
    </form>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      {expense?.hasReceipt ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <ReceiptViewer expenseId={expense.id} />
          {form}
        </div>
      ) : (
        form
      )}
    </>
  );
}
