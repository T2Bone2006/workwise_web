import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BankTransferCard } from '@/components/pay/bank-transfer-card';
import { CardPayButton, payCheckoutErrorMessage } from '@/components/pay/card-pay-button';
import { PayByBankButton, payByBankBanner } from '@/components/pay/pay-by-bank-button';
import { PayBanner, PayShell } from '@/components/pay/pay-shell';
import { loadInvoiceByToken } from '@/lib/data/payments/public-pay';
import { toInvoiceViewModel } from '@/lib/invoices/view-model';
import { Tag, type Tone } from '@/components/look';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type InvoicePayPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; error?: string; bank?: string }>;
};

function statusTag(stamp: 'PAID' | 'VOID' | 'OVERDUE' | null): { label: string; tone: Tone } {
  if (stamp === 'VOID') return { label: 'Cancelled', tone: 'slate' };
  if (stamp === 'PAID') return { label: 'Paid', tone: 'emerald' };
  if (stamp === 'OVERDUE') return { label: 'Overdue', tone: 'amber' };
  return { label: 'Unpaid', tone: 'rounds' };
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

  const { invoice, business, card, payByBank } = loaded;
  const vm = toInvoiceViewModel(invoice, { cardUrl: null });
  const pill = statusTag(vm.stamp);
  const issued = invoice.status === 'issued';
  const balance = invoice.balanceDue;
  const canPay = issued && balance > 0;
  const errorMessage = payCheckoutErrorMessage(query.error);
  const bankBanner = payByBankBanner(query.bank);

  return (
    <PayShell business={business}>
      {query.paid === '1' ? (
        <PayBanner tone="good">Thanks, your payment went through. It can take a minute to show below.</PayBanner>
      ) : null}
      {bankBanner ? <PayBanner tone={bankBanner.tone}>{bankBanner.text}</PayBanner> : null}
      {errorMessage ? (
        <PayBanner tone="warn">{errorMessage}</PayBanner>
      ) : null}
      <section className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Invoice {invoice.number}</h1>
          <Tag tone={pill.tone} className="shrink-0">{pill.label}</Tag>
        </div>
        <p className="text-sm text-muted-foreground">
          Issued {vm.issueDate} · Due {vm.dueDate}
        </p>
      </section>
      {invoice.status === 'void' ? (
        <PayBanner tone="info">This invoice was cancelled.</PayBanner>
      ) : null}
      {issued && balance <= 0 ? (
        <PayBanner tone="good">Paid. Thank you.</PayBanner>
      ) : null}
      <ul className="divide-y divide-border rounded-2xl bg-muted/60 px-4 py-3">
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
        className="inline-flex h-10 items-center justify-center rounded-full border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
      >
        Download PDF
      </a>
      {canPay && payByBank.available ? (
        <PayByBankButton token={token} from="invoice" amount={balance} />
      ) : null}
      {canPay && card.enabled ? (
        <CardPayButton token={token} kind="invoice" amount={balance} secondary={payByBank.available} />
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
