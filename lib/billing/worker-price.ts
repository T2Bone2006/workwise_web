import { PLANS, type BillingInterval } from '@/lib/billing/plans';

/** The worker price: Lite with 20% off while the worker is connected to a Pro account. */
export const WORKER_LITE_PERCENT_OFF = 20;

/** Pence, VAT-inclusive: £28 a month, £280 a year. Derived from the Lite price so the two never drift. */
export function workerLitePence(interval: BillingInterval): number {
  return Math.round((PLANS.lite.pence[interval] * (100 - WORKER_LITE_PERCENT_OFF)) / 100);
}
