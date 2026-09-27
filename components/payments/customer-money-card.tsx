'use client';

import { useState } from 'react';
import { CopyPayLinkButton } from '@/components/payments/copy-pay-link-button';
import { EmailPayLinkButton } from '@/components/payments/email-pay-link-button';
import { PreviewList } from '@/components/payments/preview-list';
import { RefundInStripeButton } from '@/components/payments/refund-in-stripe-button';
import { SendInvoiceDialog } from '@/components/payments/send-invoice-dialog';
import { RecordPaymentDialog } from '@/components/payments/record-payment-dialog';
import { VoidPaymentButton } from '@/components/payments/void-payment-button';
import { WaiveVisitButton } from '@/components/payments/waive-visit-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { CustomerLedger, LedgerPayment } from '@/lib/data/payments/ledger';
import { formatGbp } from '@/lib/money/pence';
import type { PaymentMethod } from '@/lib/payments/money-core';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  cheque: 'Cheque',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  other: 'Other',
};

const SOURCE_LABEL: Record<LedgerPayment['source'], string> = {
  stripe: 'Card',
  manual: 'Manual',
  open_banking: 'Bank',
};

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

function formatShort(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function formatReceived(iso: string): string {
  const day = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatDay(day) : iso;
}

function methodWord(method: PaymentMethod): string {
  if (method === 'bank_transfer') return 'bank transfer';
  return method;
}

export function CustomerMoneyCard({
  ledger,
  payLinkAvailable,
}: {
  ledger: CustomerLedger;
  payLinkAvailable: boolean;
}) {
  const [payOpen, setPayOpen] = useState(false);
  const [paySession, setPaySession] = useState(0);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const owed = ledger.balance.owedAmount;
  const credit = ledger.balance.creditAmount;
  const unpaid = ledger.unpaidVisits;
  const waived = ledger.recentVisits.filter((visit) => visit.paymentStatus === 'waived');
  const payments = ledger.payments;
  const nothingOwed = owed <= 0;
  const noHistory = payments.length === 0 && unpaid.length === 0 && waived.length === 0;
  const hasEmail = Boolean(ledger.customer.email?.trim());

  const since =
    ledger.balance.unpaidVisitCount > 0
      ? `${ledger.balance.unpaidVisitCount} visit${ledger.balance.unpaidVisitCount === 1 ? '' : 's'}${
          ledger.balance.oldestUnpaidDate ? ` since ${formatShort(ledger.balance.oldestUnpaidDate)}` : ''
        }`
      : null;

  const unpaidRows = unpaid.map((visit) => (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>
        {visit.date ? formatDay(visit.date) : 'Visit'} · {visit.title} ·{' '}
        {formatGbp(visit.outstanding)}
      </span>
      <WaiveVisitButton
        jobId={visit.jobId}
        customerName={ledger.customer.name}
        amount={visit.outstanding}
        waived={false}
      />
    </div>
  ));

  const waivedRows = waived.map((visit) => (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>
        {visit.date ? formatDay(visit.date) : 'Visit'} · {visit.title} · Waived
      </span>
      <WaiveVisitButton
        jobId={visit.jobId}
        customerName={ledger.customer.name}
        amount={visit.due}
        waived
      />
    </div>
  ));

  const paymentRows = payments.map((payment) => {
    const voided = payment.status === 'void';
    const disputed = Boolean(payment.disputedAt || payment.disputeStatus);
    const refunded = payment.refundedAmount > 0;
    const tone = voided
      ? 'border-l-slate-400'
      : disputed
        ? 'border-l-rose-500'
        : refunded
          ? 'border-l-amber-500'
          : 'border-l-emerald-500';
    return (
      <div
        className={`-mx-1 flex flex-wrap items-center justify-between gap-2 border-l-4 py-0.5 pl-2.5 text-sm ${tone}`}
      >
        <div className="min-w-0">
          <p className={voided ? 'text-muted-foreground line-through' : undefined}>
            {formatReceived(payment.receivedAt)} · {METHOD_LABEL[payment.method]} ·{' '}
            {formatGbp(payment.amount)}
          </p>
          {refunded ? (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Refunded {formatGbp(payment.refundedAmount)}
            </p>
          ) : null}
          {voided ? (
            <p className="text-xs text-muted-foreground">
              Cancelled — they still owe this
              {payment.voidReason ? ` · ${payment.voidReason}` : ''}
            </p>
          ) : null}
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{SOURCE_LABEL[payment.source]}</Badge>
          {disputed ? <Badge variant="destructive">Disputed</Badge> : null}
          {refunded && !voided ? (
            <Badge className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50">
              Refunded
            </Badge>
          ) : null}
          {voided ? (
            <Badge variant="secondary">Cancelled</Badge>
          ) : payment.source === 'manual' ? (
            <VoidPaymentButton
              paymentId={payment.id}
              amount={payment.amount}
              methodLabel={methodWord(payment.method)}
            />
          ) : payment.source === 'stripe' ? (
            <RefundInStripeButton />
          ) : null}
        </span>
      </div>
    );
  });

  return (
    <Card className="glass-card border-border/80">
      <CardHeader className="pb-2">
        <h2 className="text-lg font-semibold">Money</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-2">
          {nothingOwed ? (
            <p className="text-2xl font-semibold text-emerald-700 dark:text-emerald-400">All paid</p>
          ) : (
            <p className="text-2xl font-semibold text-rose-700 dark:text-rose-400">
              Owes {formatGbp(owed)}
            </p>
          )}
          {since && !nothingOwed ? (
            <span className="text-sm text-muted-foreground">{since}</span>
          ) : null}
          {credit > 0 ? <Badge variant="secondary">{formatGbp(credit)} credit</Badge> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              setPaySession((n) => n + 1);
              setPayOpen(true);
            }}
          >
            Mark as paid
          </Button>
          <CopyPayLinkButton customerId={ledger.customer.id} available={payLinkAvailable} />
          <EmailPayLinkButton
            customerId={ledger.customer.id}
            available={payLinkAvailable}
            hasEmail={hasEmail}
          />
          {nothingOwed ? null : (
            <Button variant="outline" size="sm" onClick={() => setInvoiceOpen(true)}>
              Send invoice
            </Button>
          )}
        </div>

        {noHistory ? null : (
          <>
            <PreviewList title="Unpaid visits" items={unpaidRows} />
            <PreviewList title="Waived" items={waivedRows} />
            {payments.length === 0 ? (
              nothingOwed ? null : (
                <p className="text-sm text-muted-foreground">No payments yet.</p>
              )
            ) : (
              <PreviewList title="Payments" items={paymentRows} />
            )}
          </>
        )}
      </CardContent>
      <RecordPaymentDialog
        key={paySession}
        customerId={ledger.customer.id}
        defaultAmount={owed > 0 ? owed : null}
        unpaidVisits={unpaid}
        open={payOpen}
        onOpenChange={setPayOpen}
      />
      <SendInvoiceDialog
        customerId={ledger.customer.id}
        customerEmail={ledger.customer.email}
        unpaidVisits={unpaid}
        recentVisits={ledger.recentVisits}
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
      />
    </Card>
  );
}
