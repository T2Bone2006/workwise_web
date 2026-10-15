'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Loader2, Mail, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { cancelInvoice, resendInvoice } from '@/lib/actions/payments';
import { invoiceStatus } from '@/components/payments/invoices-table';
import { Tag, type Tone } from '@/components/look';
import { Button } from '@/components/ui/button';
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
import { diffDays, todayInLondon } from '@/lib/rounds/dates';

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

function formatFull(ymd: string): string {
  const day = ymd.slice(0, 10);
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const STATUS_TONE: Record<ReturnType<typeof invoiceStatus>, Tone> = {
  Paid: 'emerald',
  Overdue: 'amber',
  Unpaid: 'rounds',
  Cancelled: 'slate',
};

// The paper's own colours: the same teal and greys as the PDF (lib/invoices/pdf/invoice-document.tsx),
// so what you see here is what the customer is sent. It stays light in dark mode, like a real page.
const PAPER_ACCENT = '#0F766E';
const PAPER_MUTED = '#6B7280';
const PAPER_LINE = '#E5E7EB';

function InvoicePaper({ invoice, status, payUrl }: { invoice: InvoiceRecord; status: ReturnType<typeof invoiceStatus>; payUrl: string }) {
  const cancelled = invoice.status === 'void';
  const initials = invoice.seller.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');
  const paid = invoice.paidNow;
  return (
    <article
      aria-label={`Invoice ${invoice.number}`}
      className="relative mx-auto w-full max-w-[760px] overflow-hidden rounded-md bg-white px-6 py-8 text-[13px] leading-snug text-[#1F2937] shadow-[0_30px_60px_-30px_rgba(15,35,71,0.45),0_0_0_1px_rgba(15,35,71,0.06)] sm:px-12 sm:py-12"
    >
      {status === 'Paid' || cancelled ? (
        <span
          className="pointer-events-none absolute top-24 right-10 -rotate-12 rounded-md border-[3px] px-4 py-1 text-2xl font-bold tracking-widest opacity-30 sm:top-28 sm:text-4xl"
          style={{ color: cancelled ? PAPER_MUTED : '#059669', borderColor: cancelled ? PAPER_MUTED : '#059669' }}
          aria-hidden="true"
        >
          {cancelled ? 'VOID' : 'PAID'}
        </span>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-3">
          {invoice.seller.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={invoice.seller.logoUrl} alt="" className="size-12 rounded-lg object-contain" />
          ) : (
            <span className="flex size-12 items-center justify-center rounded-lg bg-[#0A1A2E] text-sm font-bold text-white">
              {initials || 'W'}
            </span>
          )}
          <span className="text-base font-semibold">{invoice.seller.name}</span>
        </div>
        <div className="text-right">
          <p className="text-3xl leading-none font-bold tracking-tight sm:text-4xl" style={{ color: PAPER_ACCENT }}>
            INVOICE
          </p>
          <p className="mt-2" style={{ color: PAPER_MUTED }}>Invoice no. {invoice.number}</p>
          <p style={{ color: PAPER_MUTED }}>Date {formatFull(invoice.issueDate)}</p>
          <p style={{ color: PAPER_MUTED }}>Due {formatFull(invoice.dueDate)}</p>
        </div>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold tracking-wider" style={{ color: PAPER_MUTED }}>FROM</p>
          <p className="mt-1 font-semibold">{invoice.seller.name}</p>
          {invoice.seller.address ? <p className="whitespace-pre-line">{invoice.seller.address}</p> : null}
          {invoice.seller.vatNumber ? <p style={{ color: PAPER_MUTED }}>VAT no. {invoice.seller.vatNumber}</p> : null}
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-wider" style={{ color: PAPER_MUTED }}>BILL TO</p>
          <p className="mt-1 font-semibold">{invoice.billTo.name}</p>
          {invoice.billTo.company ? <p>{invoice.billTo.company}</p> : null}
          {invoice.billTo.address ? <p className="whitespace-pre-line">{invoice.billTo.address}</p> : null}
        </div>
      </div>

      <div className="mt-8">
        <div
          className="grid grid-cols-[4.5rem_1fr_5rem] border-b pb-2 text-[11px] font-semibold tracking-wider"
          style={{ color: PAPER_ACCENT, borderColor: PAPER_ACCENT }}
        >
          <span>DATE</span>
          <span>DESCRIPTION</span>
          <span className="text-right">AMOUNT</span>
        </div>
        {invoice.lines.map((line, index) => (
          <div
            key={`${line.jobId ?? 'line'}-${index}`}
            className="grid grid-cols-[4.5rem_1fr_5rem] border-b py-2.5"
            style={{ borderColor: PAPER_LINE }}
          >
            <span>{line.serviceDate ? formatDay(line.serviceDate) : ''}</span>
            <span>
              {line.description}
              {line.address ? <span className="block" style={{ color: PAPER_MUTED }}>{line.address}</span> : null}
            </span>
            <span className="text-right tabular-nums">{formatGbp(line.amount)}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 ml-auto w-full max-w-[18rem] space-y-1">
        {invoice.vatRatePercent != null ? (
          <>
            <div className="flex justify-between">
              <span style={{ color: PAPER_MUTED }}>Subtotal (excl. VAT)</span>
              <span className="tabular-nums">{formatGbp(invoice.subtotalNet)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: PAPER_MUTED }}>VAT {invoice.vatRatePercent}%</span>
              <span className="tabular-nums">{formatGbp(invoice.vatAmount)}</span>
            </div>
          </>
        ) : null}
        <div className="flex justify-between">
          <span style={{ color: PAPER_MUTED }}>Total</span>
          <span className="tabular-nums">{formatGbp(invoice.total)}</span>
        </div>
        {paid > 0 ? (
          <div className="flex justify-between">
            <span style={{ color: PAPER_MUTED }}>Paid so far</span>
            <span className="tabular-nums">−{formatGbp(paid)}</span>
          </div>
        ) : null}
        <div
          className="mt-2 flex items-baseline justify-between border-t pt-2"
          style={{ color: PAPER_ACCENT, borderColor: PAPER_LINE }}
        >
          <span className="text-base font-semibold">Balance due</span>
          <span className="text-2xl font-bold tabular-nums">{formatGbp(cancelled ? 0 : invoice.balanceDue)}</span>
        </div>
      </div>

      {!cancelled && (invoice.bank || payUrl) ? (
        <div className="mt-8 rounded-lg bg-[#F9FAFB] p-4">
          <p className="text-base font-semibold" style={{ color: PAPER_ACCENT }}>How to pay</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            {payUrl ? (
              <div>
                <p className="font-semibold" style={{ color: PAPER_ACCENT }}>Pay online</p>
                <p className="break-all underline" style={{ color: PAPER_ACCENT }}>{payUrl}</p>
              </div>
            ) : null}
            {invoice.bank ? (
              <div>
                <p className="font-semibold" style={{ color: PAPER_ACCENT }}>Bank transfer</p>
                <p>Account name {invoice.bank.accountName}</p>
                <p>Sort code {invoice.bank.sortCode}</p>
                <p>Account {invoice.bank.accountNumber}</p>
                <p className="font-semibold">Reference: {invoice.paymentReference ?? invoice.number}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {invoice.footer ? (
        <p className="mt-6 text-center whitespace-pre-line" style={{ color: PAPER_MUTED }}>{invoice.footer}</p>
      ) : null}
    </article>
  );
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

  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => '',
  );
  const payUrl = origin ? `${origin.replace(/^https?:\/\//, '')}/pay/i/${invoice.publicToken}` : '';

  const today = todayInLondon();
  const daysToDue = diffDays(today, invoice.dueDate.slice(0, 10));
  const dueNote =
    status === 'Paid' || status === 'Cancelled'
      ? null
      : daysToDue < 0
        ? `${-daysToDue} ${-daysToDue === 1 ? 'day' : 'days'} overdue`
        : daysToDue === 0
          ? 'Due today'
          : `Due in ${daysToDue} ${daysToDue === 1 ? 'day' : 'days'}`;
  const tone = STATUS_TONE[status];
  const amount = cancelled ? invoice.total : status === 'Paid' ? invoice.total : invoice.balanceDue;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <aside className="space-y-4 lg:sticky lg:top-6 lg:order-2">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {status === 'Paid' ? 'Paid in full' : cancelled ? 'Cancelled' : 'Balance due'}
            </p>
            <Tag tone={tone}>{status}</Tag>
          </div>
          <p
            className={
              'mt-2 text-[28px] leading-tight font-semibold tracking-tight tabular-nums ' +
              (status === 'Paid'
                ? 'text-(--tone-emerald-solid)'
                : status === 'Overdue'
                  ? 'text-(--tone-amber-text)'
                  : cancelled
                    ? 'text-muted-foreground line-through'
                    : 'text-foreground')
            }
          >
            {formatGbp(amount)}
          </p>
          {dueNote ? (
            <p className={'mt-1 text-sm ' + (status === 'Overdue' ? 'font-medium text-(--tone-amber-text)' : 'text-muted-foreground')}>
              {dueNote} · {formatDay(invoice.dueDate)}
            </p>
          ) : null}
          <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Customer</dt>
              <dd>
                <Link
                  href={`/customers/${invoice.customerId}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {invoice.billTo.name}
                </Link>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Invoice total</dt>
              <dd className="tabular-nums">{formatGbp(invoice.total)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Paid so far</dt>
              <dd className="tabular-nums">{formatGbp(invoice.paidNow)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Emailed</dt>
              <dd className="text-right">
                {invoice.sentAt && knownEmail ? `${formatDay(invoice.sentAt)} to ${knownEmail}` : 'Not yet'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:p-5">
          <Button
            className="w-full"
            disabled={pending || cancelled}
            onClick={() => {
              if (knownEmail) void send();
              else setEmailOpen(true);
            }}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
            {invoice.sentAt ? 'Resend' : 'Email to customer'}
          </Button>
          <Button variant="outline" className="w-full" asChild>
            <a href={`/api/invoices/${invoice.id}/pdf?download=1`}>
              <Download className="size-4" />
              Download PDF
            </a>
          </Button>
          <Button variant="outline" className="w-full" onClick={() => void copyLink()}>
            <Link2 className="size-4" />
            Copy customer link
          </Button>
          {cancelled ? null : (
            <Button
              variant="ghost"
              className="w-full text-(--tone-rose-text) hover:text-(--tone-rose-text)"
              onClick={() => setCancelOpen(true)}
            >
              Cancel invoice
            </Button>
          )}
        </section>
      </aside>

      <div className="min-w-0 lg:order-1">
        <InvoicePaper invoice={invoice} status={status} payUrl={payUrl} />
      </div>

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
