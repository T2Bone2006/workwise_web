'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { rowHover } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { completeRemaining } from '@/lib/actions/rounds/visits';
import { formatGbp, parseMoneyInput } from '@/lib/money/pence';
import type { Ymd } from '@/lib/rounds/dates';
import { cn } from '@/lib/utils';

export type RemainingDoneRow = {
  id: string;
  customerName: string;
  title: string;
  place: string;
  quotedAmount: number | null;
  sendInvoice: boolean;
};

type RowState = {
  cashOn: boolean;
  amount: string;
  sendMessage: boolean;
  sendInvoice: boolean;
  amountError: string | null;
};

function money(amount: number | null): string {
  return amount != null ? String(amount) : '';
}

export function MarkRemainingDone({
  date,
  dayHref,
  rows,
}: {
  date: Ymd;
  dayHref: string;
  rows: RemainingDoneRow[];
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      rows.map((row) => [
        row.id,
        {
          cashOn: false,
          amount: money(row.quotedAmount),
          sendMessage: true,
          sendInvoice: row.sendInvoice,
          amountError: null,
        },
      ]),
    ),
  );
  const [paidCash, setPaidCash] = useState(false);
  const [pending, setPending] = useState(false);

  const patch = (id: string, next: Partial<RowState>) => {
    setState((prev) => ({ ...prev, [id]: { ...prev[id]!, ...next } }));
  };

  const applyPaidCash = (on: boolean) => {
    setPaidCash(on);
    setState((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        const current = next[row.id];
        if (!current || current.sendInvoice) continue;
        next[row.id] = {
          ...current,
          cashOn: on && row.quotedAmount != null,
          amount: on ? money(row.quotedAmount) : current.amount,
          amountError: null,
        };
      }
      return next;
    });
  };

  const cashCount = rows.filter((row) => state[row.id]?.cashOn).length;
  const messageCount = rows.filter((row) => state[row.id]?.sendMessage).length;
  const invoiceCount = rows.filter((row) => state[row.id]?.sendInvoice).length;

  const submit = async () => {
    const payload: {
      jobId: string;
      cashAmount: number | null;
      sendMessage: boolean;
      sendInvoice: boolean;
    }[] = [];
    let invalid = false;
    const next = { ...state };
    for (const row of rows) {
      const current = state[row.id];
      if (!current) continue;
      let cashAmount: number | null = null;
      if (current.cashOn) {
        const parsed = parseMoneyInput(current.amount);
        if (parsed == null || parsed <= 0) {
          invalid = true;
          next[row.id] = { ...current, amountError: 'Enter an amount' };
          continue;
        }
        cashAmount = parsed;
        next[row.id] = { ...current, amountError: null };
      }
      payload.push({
        jobId: row.id,
        cashAmount,
        sendMessage: current.sendMessage,
        sendInvoice: current.sendInvoice,
      });
    }
    if (invalid) {
      setState(next);
      return;
    }

    setPending(true);
    const result = await completeRemaining({ date, rows: payload });
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    const parts = [`Marked ${result.done} done`];
    if (result.cash > 0) parts.push(`${result.cash} cash`);
    if (result.messages > 0) parts.push(`${result.messages} ${result.messages === 1 ? 'message' : 'messages'}`);
    if (result.invoices > 0) parts.push(`${result.invoices} ${result.invoices === 1 ? 'invoice' : 'invoices'}`);
    toast.success(parts.join(' · '));
    router.push(dayHref);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-(--look-card-shadow)">
        <div className="min-w-0">
          <Label htmlFor="paid-cash">They paid cash at the price</Label>
          <p className="text-sm text-muted-foreground">
            Fills cash for houses you don&apos;t invoice. Invoice houses stay as they are.
          </p>
        </div>
        <Switch id="paid-cash" checked={paidCash} onCheckedChange={applyPaidCash} disabled={pending} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-(--look-card-shadow)">
        <div className="hidden grid-cols-[minmax(0,1.6fr)_5.5rem_11rem_5.5rem_5.5rem] gap-4 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
          <span>Customer</span>
          <span>Price</span>
          <span>Cash</span>
          <span>Message</span>
          <span>Invoice</span>
        </div>
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const current = state[row.id];
            if (!current) return null;
            return (
              <li
                key={row.id}
                className={cn(
                  'grid grid-cols-1 items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_5.5rem_11rem_5.5rem_5.5rem] md:gap-4',
                  rowHover,
                )}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{row.customerName}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {[row.title, row.place].filter(Boolean).join(' · ') || 'No address yet'}
                  </p>
                </div>
                <p className="text-sm tabular-nums text-foreground">{formatGbp(row.quotedAmount)}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    id={`cash-${row.id}`}
                    checked={current.cashOn}
                    disabled={pending}
                    onCheckedChange={(on) =>
                      patch(row.id, {
                        cashOn: on,
                        amount: current.amount || money(row.quotedAmount),
                        amountError: null,
                      })
                    }
                    aria-label={`Cash for ${row.customerName}`}
                  />
                  {current.cashOn ? (
                    <Input
                      inputMode="decimal"
                      value={current.amount}
                      disabled={pending}
                      aria-label={`Cash amount for ${row.customerName}`}
                      className="h-8 w-24"
                      onChange={(event) => patch(row.id, { amount: event.target.value, amountError: null })}
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">Not paid</span>
                  )}
                  {current.amountError ? (
                    <p className="w-full text-sm text-destructive">{current.amountError}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id={`message-${row.id}`}
                    checked={current.sendMessage}
                    disabled={pending}
                    onCheckedChange={(on) => patch(row.id, { sendMessage: on })}
                    aria-label={`Message ${row.customerName}`}
                  />
                  <Label htmlFor={`message-${row.id}`} className="text-sm font-normal md:sr-only">
                    Message
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id={`invoice-${row.id}`}
                    checked={current.sendInvoice}
                    disabled={pending}
                    onCheckedChange={(on) => patch(row.id, { sendInvoice: on })}
                    aria-label={`Invoice ${row.customerName}`}
                  />
                  <Label htmlFor={`invoice-${row.id}`} className="text-sm font-normal md:sr-only">
                    Invoice
                  </Label>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {rows.length} to mark
          {cashCount > 0 ? ` · ${cashCount} cash` : ''}
          {` · ${messageCount} ${messageCount === 1 ? 'message' : 'messages'}`}
          {` · ${invoiceCount} ${invoiceCount === 1 ? 'invoice' : 'invoices'}`}
        </p>
        <Button className="ml-auto" onClick={() => void submit()} disabled={pending || rows.length === 0}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Mark {rows.length} done
        </Button>
      </div>
    </div>
  );
}
