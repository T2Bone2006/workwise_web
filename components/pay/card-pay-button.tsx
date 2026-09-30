import type { JSX } from 'react';
import { CreditCard } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { formatGbp } from '@/lib/money/pence';
import { cn } from '@/lib/utils';

const ERROR_COPY: Record<string, string> = {
  below_minimum: 'Card payments need to be at least 30p.',
  unavailable: "Card payments aren't available right now — please use bank transfer.",
  nothing_owed: "There's nothing to pay right now.",
  invalid: 'Something went wrong — please try again.',
};

export function payCheckoutErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  return ERROR_COPY[error] ?? null;
}

/** Plain form POST so a signed-out customer can start Checkout. */
export function CardPayButton(props: {
  token: string;
  kind: 'customer' | 'invoice';
  amount: number;
}): JSX.Element {
  return (
    <form method="post" action="/api/pay/checkout" className="space-y-2">
      <input type="hidden" name="token" value={props.token} />
      <input type="hidden" name="kind" value={props.kind} />
      <button
        type="submit"
        className={cn(buttonVariants({ variant: 'default', size: 'lg' }), 'w-full gap-2')}
      >
        <CreditCard className="size-4" />
        Pay {formatGbp(props.amount, { always2dp: true })} by card
      </button>
      <p className="text-center text-sm text-muted-foreground">Card, Apple Pay or Google Pay</p>
    </form>
  );
}
