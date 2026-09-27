import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BankTransferCard } from '@/components/pay/bank-transfer-card';
import { CardPayButton, payCheckoutErrorMessage } from '@/components/pay/card-pay-button';
import { PayShell } from '@/components/pay/pay-shell';
import { loadInvoiceByToken } from '@/lib/data/payments/public-pay';
import { toInvoiceViewModel } from '@/lib/invoices/view-model';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type InvoicePayPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; error?: string }>;
};

function statusPill(stamp: 'PAID' | 'VOID' | 'OVERDUE' | null): {
  label: string;
  className: string;
} {
  if (stamp === 'VOID') {
    return { label: 'Cancelled', className: 'bg-muted text-muted-foreground' };
  }
  if (stamp === 'PAID') {
    return { label: 'Paid', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' };
  }
  if (stamp === 'OVERDUE') {
    return { label: 'Overdue', className: 'bg-amber-500/15 text-amber-800 dark:text-amber-200' };
  }
  return { label: 'Unpaid', className: 'bg-muted text-foreground' };
}

export async function generateMetadata({ params }: InvoicePayPageProps): Promise<Metadata> {
  const { token } = await params;
  const loaded = await loadInvoiceByToken(token);
  return {
    title: loaded ? `Invoice ${loaded.invoice.number}` : 'Invoice',
    robots: { index: false, follow: false },
  };
}

export default async function InvoicePayPage({ params, searchParams }: InvoicePayPageProps) {
  const { token } = await params;
  const query = await searchParams;
  const loaded = await loadInvoiceByToken(token);
  if (!loaded) notFound();

  const { invoice, business, card } = loaded;
  const vm = toInvoiceViewModel(invoice, { cardUrl: null });
  const pill = statusPill(vm.stamp);
  const issued = invoice.status === 'issued';
  const balance = invoice.balanceDue;
  const canPay = issued && balance > 0;
  const errorMessage = payCheckoutErrorMessage(query.error);

  return (
    <PayShell business={business}>
      {query.paid === '1' ? (
        <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          Thanks — your payment went through. It can take a minute to show below.
        </p>
      ) : null}
      {errorMessage ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          {errorMessage}
        </p>
      ) : null}
      <section className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Invoice {invoice.number}</h1>
          <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium', pill.className)}>
            {pill.label}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Issued {vm.issueDate} · Due {vm.dueDate}
        </p>
      </section>
      {invoice.status === 'void' ? (
        <p className="text-sm font-medium">This invoice was cancelled.</p>
      ) : null}
      {issued && balance <= 0 ? (
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Paid — thank you.</p>
      ) : null}
      <ul className="divide-y divide-border">
        {vm.rows.map((row, index) => (
          <li
            key={`${row.date}-${row.description}-${index}`}
            className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="text-sm">
                {row.date ? `${row.date} · ` : null}
                {row.description}
              </p>
              {row.address ? <p className="text-sm text-muted-foreground">{row.address}</p> : null}
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums">{row.amount}</p>
          </li>
        ))}
      </ul>
      <dl className="ml-auto w-full max-w-[16rem] space-y-1 text-sm">
        {vm.totals.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-3">
            <dt className={line.strong ? 'font-semibold' : 'text-muted-foreground'}>{line.label}</dt>
            <dd className={cn('tabular-nums', line.strong && 'font-semibold')}>{line.value}</dd>
          </div>
        ))}
      </dl>
      <a
        href={`/pay/i/${token}/pdf?download=1`}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Download PDF
      </a>
      {canPay && card.enabled ? (
        <CardPayButton token={token} kind="invoice" amount={balance} />
      ) : null}
      {canPay && invoice.bank ? (
        <BankTransferCard
          bank={invoice.bank}
          reference={invoice.paymentReference}
          amount={balance}
          businessName={business.name}
        />
      ) : null}
    </PayShell>
  );
}
