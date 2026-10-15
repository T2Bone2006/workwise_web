import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download, ExternalLink } from 'lucide-react';
import { InvoiceStatusBadge } from '@/components/accountant/invoice-status-badge';
import { formatMoney, formatShortDay } from '@/components/expenses/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAccountantPage } from '@/lib/accountant/context';
import { accountantInvoice } from '@/lib/data/accountant';
import { invoiceStatus } from '@/lib/invoices/status';
import { paymentMethodLabel } from '@/lib/payments/method-labels';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One invoice, as the customer received it, with what's been paid against it. */
export default async function AccountantInvoicePage({
  params,
}: {
  params: Promise<{ token: string; invoiceId: string }>;
}) {
  const { token, invoiceId } = await params;
  const ctx = await requireAccountantPage(token);
  if (!UUID_RE.test(invoiceId)) notFound();

  const found = await accountantInvoice(createAdminClient(), ctx.tenantId, invoiceId).catch(() => 'error' as const);
  if (found === 'error') {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Couldn&apos;t load this invoice. Refresh to try again.
        </CardContent>
      </Card>
    );
  }
  if (!found) notFound();

  const { invoice, payments } = found;
  const status = invoiceStatus(invoice);
  const pdf = `/accountant/${token}/invoice/${invoice.id}`;
  const billTo = [invoice.billTo.company, invoice.billTo.name, invoice.billTo.address].filter(Boolean);
  const cancelled = invoice.status === 'void';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/accountant/${token}/invoices`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> All invoices
          </Link>
          <h2 className="text-xl font-semibold tracking-tight">{invoice.number}</h2>
          <InvoiceStatusBadge status={status} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={pdf} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" /> Open PDF
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={`${pdf}?download=1`}>
              <Download className="size-4" /> Download
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(16rem,0.8fr)]">
        <Card className="overflow-hidden py-0">
          <CardContent className="p-3 sm:p-4">
            <iframe
              title={`Invoice ${invoice.number}`}
              src={pdf}
              className="aspect-[1/1.414] w-full rounded-md border bg-white"
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Bill to</p>
                {billTo.map((line, i) => (
                  <p key={i} className={i === 0 || billTo.length === 1 ? 'font-medium' : undefined}>
                    {line}
                  </p>
                ))}
              </div>
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Issued</dt><dd>{formatShortDay(invoice.issueDate)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Due</dt><dd>{formatShortDay(invoice.dueDate)}</dd></div>
                {invoice.vatRatePercent != null ? (
                  <>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Net</dt><dd className="tabular-nums">{formatMoney(invoice.subtotalNet)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">VAT {invoice.vatRatePercent}%</dt><dd className="tabular-nums">{formatMoney(invoice.vatAmount)}</dd></div>
                  </>
                ) : null}
                <div className="flex justify-between gap-3 border-t pt-1.5"><dt className="font-medium">Total</dt><dd className="font-medium tabular-nums">{formatMoney(invoice.total)}</dd></div>
                {!cancelled ? (
                  <>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Paid</dt><dd className="tabular-nums">{formatMoney(invoice.paidNow)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Balance</dt><dd className="font-medium tabular-nums">{formatMoney(invoice.balanceDue)}</dd></div>
                  </>
                ) : null}
              </dl>
              {cancelled ? (
                <p className="text-xs text-muted-foreground">
                  Cancelled{invoice.voidReason ? `: ${invoice.voidReason}` : ''}. It isn’t counted as money billed.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payments received</CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing has been paid against this invoice yet.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {payments.map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        {formatShortDay(p.receivedOn)}
                        <span className="text-muted-foreground"> · {paymentMethodLabel(p.method)}</span>
                      </span>
                      <span className="tabular-nums">{formatMoney(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
