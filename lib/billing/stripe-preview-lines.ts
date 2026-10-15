import 'server-only';

import type { getStripe } from '@/lib/stripe/client';

/** Pure: sums the lines Stripe marks as proration (the next period's lines are not part of "now"). */
export function chargeNowFromPreviewLines(lines: ReadonlyArray<{ amount: number; proration: boolean }>): number {
  return lines.reduce((sum, line) => (line.proration ? sum + line.amount : sum), 0);
}

export type PreviewLine = {
  amount?: number;
  proration?: boolean;
  parent?: { subscription_item_details?: { proration?: boolean } | null } | null;
};

export function isProrationLine(line: PreviewLine): boolean {
  return Boolean(line.parent?.subscription_item_details?.proration ?? line.proration);
}

/** "Now" as Stripe sees it for this subscription: the test clock's time in test mode, the real time otherwise. */
export async function stripeNowUnix(stripe: ReturnType<typeof getStripe>, subscription: { test_clock?: unknown }): Promise<number> {
  const ref = subscription.test_clock;
  const clockId = typeof ref === 'string' ? ref : (ref as { id?: string } | null | undefined)?.id;
  if (clockId) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    return clock.frozen_time;
  }
  return Math.floor(Date.now() / 1000);
}

