'use client';

import { useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { openCardUpdate } from '@/lib/actions/billing';
import { formatPence } from '@/lib/billing/plans';
import type { InvoiceRow } from '@/lib/billing/manage';
import { cn } from '@/lib/utils';
import { formatBillDate, isNextRedirect, type PlanActionRun, type StripePlanSummary } from './current-plan-card';

const BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners',
  jcb: 'JCB',
  unionpay: 'UnionPay',
};

function brandLabel(brand: string): string {
  return BRANDS[brand] ?? brand.replace(/^\w/, (letter) => letter.toUpperCase());
}

function expiry(month: number, year: number): string {
  return `${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;
}

function invoiceLabel(status: InvoiceRow['status']): string {
  if (status === 'paid') return 'Paid';
  if (status === 'open') return 'Due';
  if (status === 'void') return 'Void';
  if (status === 'draft') return 'Draft';
  return 'Unpaid';
}

function invoiceTone(status: InvoiceRow['status']): string {
  if (status === 'paid') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  if (status === 'void' || status === 'draft') return 'bg-muted text-muted-foreground';
  return 'bg-amber-500/15 text-amber-800 dark:text-amber-200';
}

function StatusPill({ status }: { status: InvoiceRow['status'] }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', invoiceTone(status))}>
      {invoiceLabel(status)}
    </span>
  );
}

function PdfLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline underline-offset-4">
      PDF
    </a>
  );
}

export function PaymentAndInvoices({
  summary,
  pending,
  run,
}: {
  summary: StripePlanSummary;
  pending: boolean;
  run: PlanActionRun;
}) {
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const card = summary.card;

  const updateCard = () => {
    if (pending) return;
    setError(null);
    setUpdating(true);
    const started = run(async () => {
      try {
        const result = await openCardUpdate();
        if (!result.ok) setError(result.error);
      } catch (err) {
        if (!isNextRedirect(err)) setError('Could not open the card form. Please try again.');
      } finally {
        setUpdating(false);
      }
    });
    if (!started) setUpdating(false);
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="payment-heading">
        <h2 id="payment-heading" className="text-sm font-semibold">
          Payment
        </h2>
        <Card className="glass-card mt-3 gap-0 border-border/80 py-0">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <CreditCard className="size-4" aria-hidden />
              </span>
              <p className="text-sm font-medium">
                {card
                  ? `${brandLabel(card.brand)} ending ${card.last4} · expires ${expiry(card.expMonth, card.expYear)}`
                  : 'No card on file'}
              </p>
            </div>
            <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={pending} onClick={updateCard}>
              {updating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {card ? 'Change card' : 'Add a card'}
            </Button>
          </CardContent>
          {error ? (
            <p role="alert" className="px-4 pb-4 text-sm text-destructive sm:px-5">
              {error}
            </p>
          ) : null}
        </Card>
      </section>

      <section aria-labelledby="invoices-heading">
        <h2 id="invoices-heading" className="text-sm font-semibold">
          Invoices
        </h2>
        <Card className="glass-card mt-3 gap-0 border-border/80 py-0">
          <CardContent className="p-4 sm:p-5">
            {summary.invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Your invoices will appear here.</p>
            ) : (
              <>
                <ul className="divide-y divide-border/60 sm:hidden">
                  {summary.invoices.map((invoice) => (
                    <li key={invoice.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div>
                        <p className="text-sm font-medium">{formatBillDate(invoice.date)}</p>
                        <div className="mt-1">
                          <StatusPill status={invoice.status} />
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums">{formatPence(invoice.amountPence)}</p>
                        <div className="mt-1">
                          <PdfLink url={invoice.pdfUrl} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <table className="hidden w-full text-sm sm:table">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Amount</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 text-right font-medium">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.invoices.map((invoice) => (
                      <tr key={invoice.id} className="border-t border-border/60">
                        <td className="py-3 pr-3">{formatBillDate(invoice.date)}</td>
                        <td className="py-3 pr-3 font-medium tabular-nums">{formatPence(invoice.amountPence)}</td>
                        <td className="py-3 pr-3">
                          <StatusPill status={invoice.status} />
                        </td>
                        <td className="py-3 text-right">
                          <PdfLink url={invoice.pdfUrl} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
