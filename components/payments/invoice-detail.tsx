'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cancelInvoice, resendInvoice } from '@/lib/actions/payments';
import { invoiceStatus } from '@/components/payments/invoices-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { InvoiceRecord } from '@/lib/data/payments/invoices';
import { formatGbp } from '@/lib/money/pence';

function formatDay(ymd: string): string {
  const day = ymd.slice(0, 10);
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function InvoiceDetail({ invoice }: { invoice: InvoiceRecord }) {
  const router = useRouter();
  const status = invoiceStatus(invoice);
  const cancelled = invoice.status === 'void';
  const knownEmail = invoice.sentToEmail ?? invoice.billTo.email;
  const [emailOpen, setEmailOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);

  const send = async (to?: string) => {
    setPending(true);
    const result = await resendInvoice({ invoiceId: invoice.id, to });
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Invoice emailed');
    setEmailOpen(false);
    router.refresh();
  };

  const cancel = async () => {
    setPending(true);
    const result = await cancelInvoice({
      invoiceId: invoice.id,
      reason: reason.trim() || undefined,
    });
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Invoice cancelled');
    setCancelOpen(false);
    router.refresh();
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/pay/i/${invoice.publicToken}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
      <Card className="glass-card overflow-hidden border-border/80">
        <CardContent className="p-3 sm:p-4">
          <iframe
            title={invoice.number}
            src={`/api/invoices/${invoice.id}/pdf`}
            className="aspect-[1/1.414] w-full rounded-md border border-border/80 bg-white"
          />
        </CardContent>
      </Card>
      <Card className="glass-card border-border/80">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{invoice.number}</h2>
            {status === 'Paid' ? (
              <Badge variant="secondary">Paid</Badge>
            ) : status === 'Overdue' ? (
              <Badge variant="destructive">Overdue</Badge>
            ) : status === 'Cancelled' ? (
              <Badge variant="outline">Cancelled</Badge>
            ) : (
              <Badge variant="secondary">Unpaid</Badge>
            )}
          </div>
          <p className="text-sm">
            <Link href={`/customers/${invoice.customerId}`} className="font-medium text-primary underline-offset-4 hover:underline">
              {invoice.billTo.name}
            </Link>
          </p>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="tabular-nums">{formatGbp(invoice.total)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Balance</dt>
              <dd className="tabular-nums">{formatGbp(invoice.balanceDue)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Due</dt>
              <dd>{formatDay(invoice.dueDate)}</dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            {invoice.sentAt && knownEmail
              ? `Emailed to ${knownEmail} on ${formatDay(invoice.sentAt)}`
              : 'Not emailed yet'}
          </p>
          <div className="flex flex-col gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/invoices/${invoice.id}/pdf?download=1`}>Download PDF</a>
            </Button>
            <Button
              size="sm"
              disabled={pending || cancelled}
              onClick={() => {
                if (knownEmail) void send();
                else setEmailOpen(true);
              }}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {invoice.sentAt ? 'Resend' : 'Email to customer'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copyLink()}>
              Copy customer link
            </Button>
            {cancelled ? null : (
              <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
                Cancel invoice
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email this invoice</DialogTitle>
            <DialogDescription>No email address is on file for this customer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="invoice-resend-email">Email</Label>
            <Input
              id="invoice-resend-email"
              type="email"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEmailOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void send(address.trim())} disabled={pending || address.trim() === ''}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this invoice?</DialogTitle>
            <DialogDescription>
              Cancelling keeps the number but marks the invoice VOID. Payments already made stay on the customer&apos;s account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="invoice-cancel-reason">Reason (optional)</Label>
            <Input
              id="invoice-cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={pending}>
              Keep it
            </Button>
            <Button onClick={() => void cancel()} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Cancel invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
