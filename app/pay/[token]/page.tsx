import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CircleCheck } from 'lucide-react';
import { IconChip } from '@/components/look';
import { BankTransferCard } from '@/components/pay/bank-transfer-card';
import { CardPayButton, payCheckoutErrorMessage } from '@/components/pay/card-pay-button';
import { DirectDebitOffer } from '@/components/pay/direct-debit-offer';
import { PayByBankButton, payByBankBanner } from '@/components/pay/pay-by-bank-button';
import { PayBanner, PayShell } from '@/components/pay/pay-shell';
import { loadCustomerPayPage } from '@/lib/data/payments/public-pay';
import { formatGbp } from '@/lib/money/pence';
import { formatVisitDay } from '@/lib/payments/messages';

export const dynamic = 'force-dynamic';

type PayPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; error?: string; dd?: string; bank?: string }>;
};

export async function generateMetadata({ params }: PayPageProps): Promise<Metadata> {
  const { token } = await params;
  const page = await loadCustomerPayPage(token);
  return {
    title: page ? `Pay ${page.business.name}` : 'Payment link',
    robots: { index: false, follow: false },
  };
}

/** The banner for GoCardless's return (or a refused set-up). */
function directDebitBanner(dd: string | undefined): { tone: 'good' | 'info' | 'warn'; text: string } | null {
  switch (dd) {
    case 'done':
      return {
        tone: 'good',
        text: 'Thanks — your Direct Debit is set up. GoCardless will email you to confirm.',
      };
    case 'cancelled':
      return {
        tone: 'info',
        text: 'No problem — nothing was set up. You can do it any time from this page.',
      };
    case 'already_set_up':
      return { tone: 'info', text: "You're already set up for Direct Debit." };
    case 'not_available':
    case 'provider_error':
    case 'customer_not_found':
      return {
        tone: 'warn',
        text: "Direct Debit isn't available right now. You can still pay by card or bank transfer below.",
      };
    default:
      return null;
  }
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
  const showPayByBank = page.payByBank.available;
  const showContact = !page.bank && !page.card.enabled && !showPayByBank && !allPaid;
  const showCard = page.card.enabled && owed > 0;
  const errorMessage = payCheckoutErrorMessage(query.error);
  const ddBanner = page.directDebit.available ? directDebitBanner(query.dd) : null;
  const bankBanner = payByBankBanner(query.bank);
  const dd = page.directDebit;
  // Just back from GoCardless and not recorded yet: the banner is enough — don't offer it a second time.
  const justSetUp = query.dd === 'done' && dd.status === 'none';
  const invited = query.dd === '1';
  const offer =
    dd.available && !justSetUp ? (
      <DirectDebitOffer
        token={token}
        businessName={page.business.name}
        owedAmount={owed}
        directDebit={dd}
        highlighted={invited}
        canPayNow={showPayByBank}
      />
    ) : null;
  // Order: Direct Debit, Pay by bank, card, bank transfer. With an active Direct Debit the rest sit under "another way".
  const otherWays =
    dd.available && dd.status === 'active' && (showPayByBank || showCard || page.bank != null);

  return (
    <PayShell business={page.business}>
      {query.paid === '1' ? (
        <PayBanner tone="good">Thanks, your payment went through. It can take a minute to show below.</PayBanner>
      ) : null}
      {ddBanner ? <PayBanner tone={ddBanner.tone}>{ddBanner.text}</PayBanner> : null}
      {bankBanner ? <PayBanner tone={bankBanner.tone}>{bankBanner.text}</PayBanner> : null}
      {errorMessage ? (
        <PayBanner tone="warn">{errorMessage}</PayBanner>
      ) : null}
      {page.customerFirstName ? (
        <p className="text-sm text-muted-foreground">Hi {page.customerFirstName},</p>
      ) : null}
      <section className="rounded-2xl bg-muted/60 p-4 sm:p-5">
        {allPaid ? (
          <>
            <p className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-(--tone-emerald-text)">
              <IconChip icon={CircleCheck} tone="emerald" size="sm" />
              You&apos;re all paid up. Thank you.
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
            <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-(--tone-emerald-solid)">
              {formatGbp(owed)}
            </p>
            {page.otherOwed.length > 0 || shownVisits.length > 0 ? (
              <ul className="mt-4 divide-y divide-border">
                {page.otherOwed.map((item, index) => (
                  <li
                    key={`other-${item.date}-${index}`}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm">{item.description}</p>
                      <p className="text-sm text-muted-foreground">{formatVisitDay(item.date)}</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatGbp(item.outstanding)}
                    </p>
                  </li>
                ))}
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
      {offer}
      {otherWays ? <p className="text-sm font-medium text-muted-foreground">Want to pay another way?</p> : null}
      {showPayByBank ? <PayByBankButton token={token} from="customer" amount={owed} /> : null}
      {showCard ? <CardPayButton token={token} kind="customer" amount={owed} secondary={showPayByBank} /> : null}
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
