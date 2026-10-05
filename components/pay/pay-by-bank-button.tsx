import type { JSX } from 'react';
import { Landmark } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { formatGbp } from '@/lib/money/pence';
import { cn } from '@/lib/utils';

const BANK_RETURN_COPY: Record<string, { tone: 'good' | 'info' | 'warn'; text: string }> = {
  done: {
    tone: 'good',
    text: "Thanks — your bank is sending the payment. It'll show as paid in a moment.",
  },
  cancelled: { tone: 'info', text: 'No problem — nothing was paid.' },
  nothing_owed: { tone: 'info', text: "There's nothing to pay right now." },
  already_set_up: { tone: 'info', text: "You're already set up for Direct Debit." },
  too_large: {
    tone: 'warn',
    text: "Pay by bank isn't available right now. You can pay by card or bank transfer below.",
  },
  not_available: {
    tone: 'warn',
    text: "Pay by bank isn't available right now. You can pay by card or bank transfer below.",
  },
  provider_error: {
    tone: 'warn',
    text: "Pay by bank isn't available right now. You can pay by card or bank transfer below.",
  },
};

/** The banner for the `?bank=` return from GoCardless (or a refused start). */
export function payByBankBanner(
  bank: string | undefined,
): { tone: 'good' | 'info' | 'warn'; text: string } | null {
  if (!bank) return null;
  return BANK_RETURN_COPY[bank] ?? null;
}

/**
 * Pay by bank (GoCardless) — a plain form POST so a signed-out customer can
 * start it. The amount is never sent: the server works it out.
 */
export function PayByBankButton(props: {
  token: string;
  from: 'customer' | 'invoice';
  amount: number;
}): JSX.Element {
  return (
    <form method="post" action="/api/pay/bank" className="space-y-2">
      <input type="hidden" name="token" value={props.token} />
      <input type="hidden" name="from" value={props.from} />
      <input type="hidden" name="kind" value="pay_by_bank" />
      <button
        type="submit"
        className={cn(buttonVariants({ variant: 'default', size: 'lg' }), 'h-12 w-full gap-2 rounded-full text-[15px]')}
      >
        <Landmark className="size-4" />
        Pay {formatGbp(props.amount, { always2dp: true })} by bank
      </button>
      <p className="text-center text-sm text-muted-foreground">
        Approve it in your banking app. No card needed.
      </p>
    </form>
  );
}
