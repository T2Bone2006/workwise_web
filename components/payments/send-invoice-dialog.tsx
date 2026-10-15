'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createInvoice } from '@/lib/actions/payments';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LedgerVisit } from '@/lib/data/payments/ledger';
import { formatGbp } from '@/lib/money/pence';
import { formatVisitDay } from '@/lib/payments/messages';

const STATUS_WORD: Record<LedgerVisit['paymentStatus'], string> = {
  unpaid: 'Unpaid',
  partial: 'Part paid',
  paid: 'Paid',
  waived: 'Waived',
};

function visitLabel(visit: LedgerVisit): string {
  const day = visit.date && /^\d{4}-\d{2}-\d{2}$/.test(visit.date) ? formatVisitDay(visit.date) : 'Visit';
  return `${day} · ${formatGbp(visit.due)} · ${STATUS_WORD[visit.paymentStatus]}`;
}

export function SendInvoiceDialog({
  customerId,
  customerEmail,
  unpaidVisits,
  recentVisits,
  open,
  onOpenChange,
}: {
  customerId: string;
  customerEmail: string | null;
  unpaidVisits: LedgerVisit[];
  recentVisits: LedgerVisit[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const owed = unpaidVisits.reduce((sum, visit) => sum + visit.outstanding, 0);
  const nothingOwed = unpaidVisits.length === 0 || owed <= 0;
  const visits = useMemo(() => {
    const byId = new Map<string, LedgerVisit>();
    for (const visit of [...unpaidVisits, ...recentVisits]) {
      if (!byId.has(visit.jobId)) byId.set(visit.jobId, visit);
    }
    return [...byId.values()].sort((a, b) => {
      if (a.date == null && b.date != null) return 1;
      if (a.date != null && b.date == null) return -1;
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.jobId.localeCompare(a.jobId);
    });
  }, [unpaidVisits, recentVisits]);

  const [scope, setScope] = useState<'balance' | 'visit'>(nothingOwed ? 'visit' : 'balance');
  const [jobId, setJobId] = useState(visits[0]?.jobId ?? '');
  const [emailIt, setEmailIt] = useState(Boolean(customerEmail));
  const [to, setTo] = useState('');
  const [pending, setPending] = useState(false);

  const handle = async () => {
    if (scope === 'visit' && !jobId) {
      toast.error('Choose a visit');
      return;
    }
    setPending(true);
    const result = await createInvoice({
      customerId,
      scope,
      jobId: scope === 'visit' ? jobId : undefined,
      email: customerEmail ? emailIt : to.trim() !== '',
      to: customerEmail ? undefined : to.trim() || undefined,
    });
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    if (result.existing) {
      toast.success(`${result.number} already exists for that visit — opened it`);
    } else if (result.emailed) {
      toast.success(`Invoice ${result.number} emailed`);
    } else {
      toast.success(`Invoice ${result.number} created`);
    }
    onOpenChange(false);
    router.push(`/payments/invoices/${result.invoiceId}`);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="invoice-scope"
              className="mt-1"
              checked={scope === 'balance'}
              disabled={nothingOwed}
              onChange={() => setScope('balance')}
            />
            <span className={nothingOwed ? 'text-muted-foreground' : undefined}>
              {`Everything owed (${formatGbp(owed)}, ${unpaidVisits.length} ${unpaidVisits.length === 1 ? 'visit' : 'visits'})`}
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="invoice-scope"
              className="mt-1"
              checked={scope === 'visit'}
              onChange={() => setScope('visit')}
            />
            <span>One visit</span>
          </label>
          {scope === 'visit' ? (
            <div className="space-y-1">
              <Label htmlFor="invoice-visit">Visit</Label>
              <select
                id="invoice-visit"
                value={jobId}
                onChange={(event) => setJobId(event.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {visits.length === 0 ? <option value="">No visits</option> : null}
                {visits.map((visit) => (
                  <option key={visit.jobId} value={visit.jobId}>
                    {visitLabel(visit)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {customerEmail ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={emailIt} onCheckedChange={(value) => setEmailIt(value === true)} />
              Email it to {customerEmail}
            </label>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="invoice-email">Email (optional)</Label>
              <Input
                id="invoice-email"
                type="email"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="name@email.com"
              />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void handle()} disabled={pending || (scope === 'visit' && !jobId)}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Create invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
