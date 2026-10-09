import { PRO_PLANS, type ProChoice } from '@/lib/billing/pro-plans';

export type ProRestartLine = { price: string; quantity: number };

/** Plan line (quantity 1) plus the extra-worker line when the team is over the tier's allowance. */
export function proRestartLines(input: {
  planPriceId: string;
  extraPriceId: string | null;
  teamSize: number;
  included: number;
}): ProRestartLine[] {
  const lines: ProRestartLine[] = [{ price: input.planPriceId, quantity: 1 }];
  const over = Math.max(0, Math.floor(input.teamSize) - input.included);
  if (over > 0 && input.extraPriceId) lines.push({ price: input.extraPriceId, quantity: over });
  return lines;
}

type SubRow = { source: string | null; product: string | null; status: string | null };

const ENTITLED = new Set(['trialing', 'active', 'past_due', 'manual']);
const PRO_PRODUCTS = new Set(['starter', 'growth', 'pro']);

/**
 * The overdue banner rule. True for a business with a Stripe customer, no manual row anywhere, and at least
 * one Stripe row that is past_due (any product, Pro included). A manual row means WorkWise runs the account by
 * hand, so there is no card to update.
 */
export function isPaymentOverdue(rows: SubRow[] | null | undefined, hasCustomer: boolean): boolean {
  if (!hasCustomer || !rows) return false;
  if (rows.some((row) => row.source === 'manual')) return false;
  return rows.some((row) => row.source === 'stripe' && row.status === 'past_due' && row.product != null);
}

/** What the restart page may offer: the latest ended Stripe-billed Pro plan, or null when there is nothing to restart. */
export function endedProChoice(
  rows: Array<SubRow & { billing_interval?: string | null }> | null | undefined,
  hasCustomer: boolean,
): ProChoice | null {
  if (!hasCustomer || !rows || rows.length === 0) return null;
  if (rows.some((row) => row.source === 'manual')) return null;
  if (rows.some((row) => row.status != null && ENTITLED.has(row.status))) return null;
  const latest = rows.find((row) => row.source === 'stripe' && row.product != null && PRO_PRODUCTS.has(row.product));
  if (!latest) return null;
  const tier = latest.product as ProChoice['tier'];
  return { tier, interval: latest.billing_interval === 'year' ? 'year' : 'month' };
}

/** The sentence under the tier rows when the team is over the allowance; null when it isn't. */
export function proRestartSummary(choice: ProChoice, teamSize: number): string | null {
  const plan = PRO_PLANS[choice.tier];
  const over = Math.max(0, teamSize - plan.included);
  if (over === 0) return null;
  const planPence = plan.pence[choice.interval];
  const extrasPence = over * plan.extraPence[choice.interval];
  const pounds = (p: number) => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: p % 100 === 0 ? 0 : 2 })}`;
  return `${plan.name}: ${pounds(planPence)} + ${over} extra ${over === 1 ? 'worker' : 'workers'} ${pounds(extrasPence)} = ${pounds(planPence + extrasPence)} ${choice.interval === 'month' ? 'a month' : 'a year'}`;
}
