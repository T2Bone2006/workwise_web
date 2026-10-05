import type { JSX } from 'react';
import { Repeat } from 'lucide-react';
import { IconChip } from '@/components/look';
import { formatGbp } from '@/lib/money/pence';
import type { CustomerPayPage } from '@/lib/data/payments/public-pay';

/**
 * The Direct Debit card on the customer's pay page (D4). The bank details are
 * only ever entered on GoCardless's own page — the button posts the pay token
 * and is sent there.
 */
export function DirectDebitOffer(props: {
  token: string;
  businessName: string;
  owedAmount: number;
  directDebit: CustomerPayPage['directDebit'];
  /** Arrived from the invitation link (?dd=1). */
  highlighted: boolean;
  /** Pay by bank works (Direct Debit On, at least £1 owed): offer "pay now + set up". */
  canPayNow: boolean;
}): JSX.Element | null {
  const { token, businessName, owedAmount, directDebit, highlighted, canPayNow } = props;
  if (!directDebit.available) return null;
  const ending = directDebit.bankEnding ? ` ••${directDebit.bankEnding}` : '';

  return (
    <section
      className={
        highlighted && directDebit.status === 'none'
          ? 'rounded-2xl border border-(--tone-emerald-solid) bg-(--tone-emerald-soft) p-4 ring-1 ring-(--tone-emerald-line)'
          : 'rounded-2xl border border-(--tone-emerald-line) bg-(--tone-emerald-soft) p-4'
      }
    >
      <p className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
        <IconChip icon={Repeat} tone="emerald" size="sm" />
        {directDebit.status === 'none' ? 'Pay automatically by Direct Debit' : 'Direct Debit'}
      </p>
      {directDebit.status === 'none' ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Set it up once and {businessName} collects what you owe after each visit. You&apos;ll get an
            email before every payment, and you can cancel any time with your bank.
          </p>
          {owedAmount > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              The {formatGbp(owedAmount, { always2dp: true })} you owe now will be collected first.
            </p>
          ) : null}
          <form method="post" action="/api/pay/direct-debit" className="mt-4">
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="inline-flex h-11 w-full items-center justify-center rounded-full bg-(--tone-emerald-solid) px-4 text-sm font-semibold text-white transition-colors hover:bg-(--tone-emerald-solid)/90"
            >
              Set up Direct Debit
            </button>
          </form>
          {canPayNow ? (
            <form method="post" action="/api/pay/bank" className="mt-2">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="from" value="customer" />
              <input type="hidden" name="kind" value="pay_and_dd" />
              <button
                type="submit"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-border bg-card px-4 py-2 text-center text-sm font-medium transition-colors hover:bg-muted"
              >
                Pay the {formatGbp(owedAmount, { always2dp: true })} now by bank and set up Direct Debit
              </button>
            </form>
          ) : null}
        </>
      ) : null}
      {directDebit.status === 'pending' ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Your Direct Debit is being set up with your bank (about 3 working days). {businessName} will
          collect from{ending || ' your account'} after each visit.
        </p>
      ) : null}
      {directDebit.status === 'active' ? (
        <p className="mt-2 text-sm text-muted-foreground">
          You pay {businessName} by Direct Debit from{ending || ' your account'}. Anything owed is
          collected automatically — you don&apos;t need to do anything.
        </p>
      ) : null}
    </section>
  );
}
