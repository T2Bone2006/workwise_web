import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CircleCheck } from 'lucide-react';
import { BankTransferCard } from '@/components/pay/bank-transfer-card';
import { CardPayButton, payCheckoutErrorMessage } from '@/components/pay/card-pay-button';
import { PayShell } from '@/components/pay/pay-shell';
import { loadCustomerPayPage } from '@/lib/data/payments/public-pay';
import { formatGbp } from '@/lib/money/pence';
import { formatVisitDay } from '@/lib/payments/messages';

export const dynamic = 'force-dynamic';

type PayPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; error?: string }>;
};

export async function generateMetadata({ params }: PayPageProps): Promise<Metadata> {
  const { token } = await params;
  const page = await loadCustomerPayPage(token);
  return {
    title: page ? `Pay ${page.business.name}` : 'Payment link',
    robots: { index: false, follow: false },
  };
}

function visitLabel(date: string | null, title: string): string {
  if (!date) return title;
  return `${formatVisitDay(date)} · ${title}`;
}

export default async function CustomerPayPage({ params, searchParams }: PayPageProps) {
  const { token } = await params;
  const query = await searchParams;
  const page = await loadCustomerPayPage(token);
  if (!page) notFound();

  const owed = page.owedAmount;
  const allPaid = owed <= 0;
  const shownVisits = page.unpaidVisits.slice(0, 5);
  const hiddenCount = page.unpaidVisits.length - shownVisits.length;
  const showContact = !page.bank && !page.card.enabled && !allPaid;
  const showCard = page.card.enabled && owed > 0;
  const errorMessage = payCheckoutErrorMessage(query.error);

  return (
    <PayShell business={page.business}>
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
      {page.customerFirstName ? (
        <p className="text-sm text-muted-foreground">Hi {page.customerFirstName},</p>
      ) : null}
      <section className="rounded-xl border border-border/80 bg-card/60 p-4">
        {allPaid ? (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold tracking-tight text-emerald-700 dark:text-emerald-300">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                <CircleCheck className="size-3.5" />
              </span>
              You&apos;re all paid up — thank you.
            </p>
            {page.creditAmount > 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                You have {formatGbp(page.creditAmount)} credit.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">You owe</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-300">
              {formatGbp(owed)}
            </p>
            {shownVisits.length > 0 ? (
              <ul className="mt-4 divide-y divide-border">
                {shownVisits.map((visit, index) => (
                  <li
                    key={`${visit.date ?? 'visit'}-${visit.title}-${index}`}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm">{visitLabel(visit.date, visit.title)}</p>
                      {visit.address ? (
                        <p className="text-sm text-muted-foreground">{visit.address}</p>
                      ) : null}
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatGbp(visit.outstanding)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
            {hiddenCount > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">and {hiddenCount} more</p>
            ) : null}
          </>
        )}
      </section>
      {showCard ? <CardPayButton token={token} kind="customer" amount={owed} /> : null}
      {page.bank ? (
        <BankTransferCard
          bank={page.bank}
          reference={page.reference}
          amount={allPaid ? null : owed}
          businessName={page.business.name}
          heading={allPaid ? 'Want to pay ahead?' : 'Pay by bank transfer'}
        />
      ) : null}
      {showContact ? (
        <p className="text-sm text-muted-foreground">Contact {page.business.name} to pay.</p>
      ) : null}
    </PayShell>
  );
}
