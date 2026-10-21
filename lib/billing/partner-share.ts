/** Pure maths for a partner referral. No database, no Stripe. */

export const PARTNER_SHARE_MONTHS = 12;

/** 3–16 letters or digits. Customer referral codes are a subset of this (8 characters). */
export const SIGNUP_CODE_RE = /^[A-Z0-9]{3,16}$/;

/** Trim and uppercase. Null when it is not a code someone could type. */
export function normaliseSignupCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return SIGNUP_CODE_RE.test(code) ? code : null;
}

/** Twelve months after the account was created. The instant at the end is not included. */
export function partnerWindowEnd(startedAt: Date): Date {
  const end = new Date(startedAt.getTime());
  end.setUTCMonth(end.getUTCMonth() + PARTNER_SHARE_MONTHS);
  return end;
}

export type CountedInvoice = {
  status: string | null;
  /** Unix seconds, as Stripe sends them. */
  created: number;
  /** Pence actually kept: amount paid minus refunds recorded as credit notes. */
  amountPaid: number;
  /** Set only for a subscription invoice. A text-pack invoice has none and does not count. */
  subscriptionId: string | null;
};

/**
 * Subscription money received in [start, end). A free month is 0. A half-price month counts as the half.
 * Invoices with no subscription (text packs) do not count.
 */
export function collectedPence(invoices: CountedInvoice[], window: { start: Date; end: Date }): number {
  const start = Math.floor(window.start.getTime() / 1000);
  const end = Math.floor(window.end.getTime() / 1000);
  return invoices.reduce((sum, invoice) => {
    if (invoice.status !== 'paid') return sum;
    if (!invoice.subscriptionId) return sum;
    if (invoice.created < start || invoice.created >= end) return sum;
    if (invoice.amountPaid <= 0) return sum;
    return sum + invoice.amountPaid;
  }, 0);
}

/** 10% of the pence received, to the nearest penny. */
export function sharePence(collected: number): number {
  if (collected <= 0) return 0;
  return Math.round(collected * 0.1);
}

/** What is still to send. Never negative when a later refund drops the total below what was already marked paid. */
export function outstandingPence(owed: number, paid: number): number {
  return Math.max(0, owed - paid);
}
