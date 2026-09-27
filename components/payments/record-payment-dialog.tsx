'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { recordPayment } from '@/lib/actions/payments';
import type { LedgerVisit } from '@/lib/data/payments/ledger';
import { formatGbp, parseMoneyInput } from '@/lib/money/pence';
import type { PaymentMethod } from '@/lib/payments/money-core';
import { todayInLondon } from '@/lib/rounds/dates';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card (card machine)' },
  { value: 'other', label: 'Other' },
];

function formatVisitOption(visit: LedgerVisit): string {
  const day = visit.date ? formatDay(visit.date) : 'Visit';
  return `${day} · ${formatGbp(visit.outstanding)}`;
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function toOffsetIso(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
  const off = -dt.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${ymd}T12:00:00${sign}${hh}:${mm}`;
}

export function RecordPaymentDialog({
  customerId,
  defaultAmount,
  unpaidVisits,
  open,
  onOpenChange,
}: {
  customerId: string;
  defaultAmount: number | null;
  unpaidVisits: LedgerVisit[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(
    defaultAmount != null && defaultAmount > 0 ? String(defaultAmount) : '',
  );
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [date, setDate] = useState(todayInLondon());
  const [note, setNote] = useState('');
  const [jobId, setJobId] = useState('auto');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayInLondon();

  const handle = async () => {
    const parsed = parseMoneyInput(amount);
    if (parsed == null || parsed <= 0) {
      setError('Enter an amount');
      return;
    }
    if (!method) {
      setError('Choose a method');
      return;
    }
    if (date > today) {
      setError('Date cannot be in the future');
      return;
    }

    setPending(true);
    const result = await recordPayment({
      customerId,
      amount: parsed,
      method,
      receivedAt: toOffsetIso(date),
      note,
      appliesToJobId: jobId === 'auto' ? null : jobId,
    });
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(`${formatGbp(parsed)} recorded`);
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as paid</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="payment-amount">Amount</Label>
            <Input
              id="payment-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Method</Label>
            <Select
              value={method || undefined}
              onValueChange={(v) => setMethod(v as PaymentMethod)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="payment-date">Date</Label>
            <Input
              id="payment-date"
              type="date"
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="payment-note">Note</Label>
            <Input
              id="payment-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>For a visit</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Oldest first (automatic)</SelectItem>
                {unpaidVisits.map((visit) => (
                  <SelectItem key={visit.jobId} value={visit.jobId}>
                    {formatVisitOption(visit)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void handle()} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
