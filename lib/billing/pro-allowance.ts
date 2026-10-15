/**
 * Pro worker allowance: how many workers a Pro tier includes and what each
 * extra worker costs. The three Pro tiers are the same product; the allowance
 * is the only software difference.
 *
 * The numbers mirror PRO_TIERS in workwise_site/lib/site.ts (the pricing page).
 * Change them in both places. All amounts are monthly; a yearly plan is ten months'
 * price for the plan AND for each extra worker (lib/billing/pro-plans.ts).
 *
 * Pure: no database, no server-only imports, so it is easy to test.
 */

import { extrasToBill } from '@/lib/billing/extra-workers-core';

/** A yearly plan costs this many months of the monthly price (plan and extra workers alike). */
export const YEARLY_MONTHS = 10;

export type ProTier = 'starter' | 'growth' | 'pro';

export const PRO_TIER_ORDER: readonly ProTier[] = ['starter', 'growth', 'pro'];

export const PRO_ALLOWANCES: Record<
  ProTier,
  { name: string; included: number; extraWorkerPounds: number; planMonthlyPounds: number }
> = {
  starter: { name: 'Starter', included: 10, extraWorkerPounds: 12, planMonthlyPounds: 149 },
  growth: { name: 'Growth', included: 35, extraWorkerPounds: 9, planMonthlyPounds: 449 },
  pro: { name: 'Pro', included: 70, extraWorkerPounds: 6, planMonthlyPounds: 749 },
};

export type AllowanceInput = {
  tier: ProTier;
  /** 'manual' = granted by WorkWise with no Stripe subscription behind it. */
  source: 'stripe' | 'manual';
  /** Custom included count for this business (subscriptions.included_workers_override); null = tier default. */
  includedOverride: number | null;
  /** From subscriptions.billing_interval; unknown (undefined or null) is treated as monthly for wording. */
  interval?: 'month' | 'year' | null;
  /** Workers on the team now (accepted and pending invites; not deactivated). */
  used: number;
  /** Team size already paid for at sign-up (extras billed up front), or null/undefined when extras follow headcount. */
  paidFor?: number | null;
};

export type Allowance = {
  tier: ProTier;
  tierName: string;
  /** False for manual accounts: no allowance, no charge, nothing is ever blocked or shown. */
  limited: boolean;
  included: number;
  used: number;
  /** Workers beyond the allowance right now (0 when unlimited). */
  over: number;
  extraWorkerPounds: number;
  /** Monthly or yearly billing; null when unknown. */
  interval: 'month' | 'year' | null;
  /** Team size paid for at sign-up that the real team has not reached yet; null otherwise. */
  paidFor: number | null;
};

/** Extra workers on the bill when the team is `used` strong: those over the allowance, or the ones paid for at sign-up. */
export function billedExtras(a: Allowance, used: number): number {
  if (!a.limited) return 0;
  return extrasToBill({ used, included: a.included, paidForWorkers: a.paidFor }).over;
}

export function computeAllowance(input: AllowanceInput): Allowance {
  const base = PRO_ALLOWANCES[input.tier];
  const override =
    input.includedOverride != null && Number.isInteger(input.includedOverride) && input.includedOverride >= 0
      ? input.includedOverride
      : null;
  const included = override ?? base.included;
  const limited = input.source !== 'manual';
  return {
    tier: input.tier,
    tierName: base.name,
    limited,
    included,
    used: input.used,
    over: limited ? Math.max(0, input.used - included) : 0,
    extraWorkerPounds: base.extraWorkerPounds,
    interval: input.interval ?? null,
    paidFor: input.paidFor ?? null,
  };
}

/** What the confirmation dialog shows when adding one more worker would go over the allowance. */
export type ExtraWorkerNotice = {
  tierName: string;
  /** The number this worker would be (e.g. 11). */
  workerNumber: number;
  included: number;
  /** One extra worker, per MONTH, in pounds (12 for Starter). See perWorkerPence for the interval being billed. */
  extraWorkerPounds: number;
  /** Extra workers there will be once this one is added (always at least 1). */
  extrasAfter: number;
  interval: 'month' | 'year';
  /** One extra worker's price in pence for this interval: 1200 / 12000 for Starter, 900 / 9000 Growth, 600 / 6000 Pro. */
  perWorkerPence: number;
  /** Yearly only, filled in by the server from Stripe's preview: pence charged now (pro-rata). null = not available. */
  chargeNowPence?: number | null;
};

/** Returns the notice to confirm, or null when one more worker fits (or the business is unlimited). */
export function noticeForNextWorker(a: Allowance): ExtraWorkerNotice | null {
  if (!a.limited) return null;
  // Nothing new is charged when this worker is one of the extras already on the bill (paid for at sign-up).
  const extrasAfter = billedExtras(a, a.used + 1);
  if (extrasAfter <= billedExtras(a, a.used)) return null;
  const interval = a.interval === 'year' ? 'year' : 'month';
  return {
    tierName: a.tierName,
    workerNumber: a.used + 1,
    included: a.included,
    extraWorkerPounds: a.extraWorkerPounds,
    extrasAfter,
    interval,
    perWorkerPence: a.extraWorkerPounds * 100 * (interval === 'year' ? YEARLY_MONTHS : 1),
  };
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function pounds(pence: number): string {
  const whole = Math.floor(pence / 100);
  const rest = pence % 100;
  return rest === 0 ? `£${whole.toLocaleString('en-GB')}` : `£${whole.toLocaleString('en-GB')}.${String(rest).padStart(2, '0')}`;
}

/** "This is your 11th worker. Your Starter plan includes 10. Each extra worker is £12 a month."
 *  Yearly: "…Each extra worker is £120 a year, charged for the months you have left." */
export function noticeSentence(n: ExtraWorkerNotice): string {
  const lead = `This is your ${ordinal(n.workerNumber)} worker. Your ${n.tierName} plan includes ${n.included}.`;
  return n.interval === 'year'
    ? `${lead} Each extra worker is ${pounds(n.perWorkerPence)} a year, charged for the months you have left.`
    : `${lead} Each extra worker is £${n.extraWorkerPounds} a month.`;
}

/** The small line under the Workers header, or null when nothing should show (manual accounts).
 *  Up to the plan: "33 / 35 workers". Extras paid for at sign-up count as part of the plan until the team reaches
 *  that size: "0 / 40 workers". Over the plan it is just the head count: "39 workers" (what the extras cost is on
 *  Plan & billing and in the add-worker dialog). */
export function usageLine(a: Allowance): string | null {
  if (!a.limited) return null;
  const billed = billedExtras(a, a.used);
  const paidAhead = billed > a.over;
  if (a.used <= a.included) return `${a.used} / ${a.included + (paidAhead ? billed : 0)} workers`;
  if (paidAhead) return `${a.used} / ${a.included + billed} workers`;
  return `${a.used} workers`;
}

/** What adding several workers at once does to the bill. One confirmation covers the whole batch. */
export type BatchNotice = {
  tier: ProTier;
  tierName: string;
  included: number;
  /** Team size now, how many are being added, and the size after. */
  teamBefore: number;
  adding: number;
  teamAfter: number;
  /** Workers over the allowance before and after; newExtras = extrasAfter - extrasBefore (always > 0 for a notice). */
  extrasBefore: number;
  extrasAfter: number;
  newExtras: number;
  extraWorkerPounds: number;
};

/** null when the batch fits inside the allowance, is covered by extras already paid for, or the business is unlimited (manual). */
export function noticeForBatch(a: Allowance, adding: number): BatchNotice | null {
  if (!a.limited || !Number.isFinite(adding) || adding <= 0) return null;
  const count = Math.floor(adding);
  const teamAfter = a.used + count;
  const extrasBefore = billedExtras(a, a.used);
  const extrasAfter = billedExtras(a, teamAfter);
  const newExtras = extrasAfter - extrasBefore;
  if (newExtras <= 0) return null;
  return {
    tier: a.tier,
    tierName: a.tierName,
    included: a.included,
    teamBefore: a.used,
    adding: count,
    teamAfter,
    extrasBefore,
    extrasAfter,
    newExtras,
    extraWorkerPounds: a.extraWorkerPounds,
  };
}
