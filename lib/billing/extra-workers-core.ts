/**
 * Pure planning for the "extra worker" line on a Pro subscription.
 *
 * A Stripe subscription for a Pro business has its plan line (Starter, Growth or Pro) and, when the team
 * is bigger than the plan includes, a second line whose quantity is the number of workers over the allowance.
 * Given how many are over and what the subscription has now, this says what to do. No Stripe, no database.
 */

export type ExtraWorkerLine = { itemId: string; priceId: string; quantity: number };

export type ExtraWorkerAction =
  | { kind: 'none' }
  | { kind: 'add'; priceId: string; quantity: number }
  | { kind: 'set'; itemId: string; priceId: string; quantity: number }
  | { kind: 'remove'; itemId: string };

/** Team size stored on the subscription at signup, once extras were paid for up front. Empty means "follow headcount". */
export function paidForWorkers(metadata: { expected_workers?: string | null } | null | undefined): number | null {
  const raw = metadata?.expected_workers;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
}

/**
 * How many extra workers to keep on the bill.
 * A signup that already paid for a team bigger than the allowance holds that quantity until the real team
 * reaches it. After that, the bill follows the people on the team (including a later shrink).
 */
export function extrasToBill(input: {
  used: number;
  included: number;
  /** Team size paid for at signup, or null when extras follow headcount only. */
  paidForWorkers: number | null;
}): { over: number; releasePaidFor: boolean } {
  const used = Number.isFinite(input.used) ? Math.max(0, Math.floor(input.used)) : 0;
  const included = Number.isFinite(input.included) ? Math.max(0, Math.floor(input.included)) : 0;
  const actual = Math.max(0, used - included);
  if (input.paidForWorkers == null || !Number.isFinite(input.paidForWorkers)) {
    return { over: actual, releasePaidFor: false };
  }
  const paidFor = Math.floor(input.paidForWorkers);
  if (used >= paidFor) return { over: actual, releasePaidFor: true };
  return { over: Math.max(actual, Math.max(0, paidFor - included)), releasePaidFor: false };
}

export function planExtraWorkerChange(p: {
  /** Workers over the allowance right now (0 = none). */
  over: number;
  /** The extra-worker price for this business's tier. */
  wantedPriceId: string;
  /** The extra-worker line already on the subscription, if any. */
  current: ExtraWorkerLine | null;
}): ExtraWorkerAction {
  const over = Math.max(0, Math.floor(p.over));
  if (over === 0) return p.current ? { kind: 'remove', itemId: p.current.itemId } : { kind: 'none' };
  if (!p.current) return { kind: 'add', priceId: p.wantedPriceId, quantity: over };
  if (p.current.priceId !== p.wantedPriceId || p.current.quantity !== over) {
    return { kind: 'set', itemId: p.current.itemId, priceId: p.wantedPriceId, quantity: over };
  }
  return { kind: 'none' };
}

export type ProrationBehavior = 'create_prorations' | 'always_invoice';

/** Yearly: charge or credit now (the whole subscription renews on one date, so the unused part is settled at once).
 *  Monthly: roll the change into the next bill. */
export function prorationFor(interval: 'month' | 'year'): ProrationBehavior {
  return interval === 'year' ? 'always_invoice' : 'create_prorations';
}
