/**
 * Pure helpers for the Pro Plan & billing page: telling a subscription's plan line from its extra-worker
 * line, and working out what the business pays each month. No Stripe, no database.
 */
import type { ProTier } from '@/lib/billing/pro-allowance';

export type ProItem = { id: string; priceId: string; quantity: number; unitPence: number | null };

/** Splits a subscription's lines into the plan line (a known Pro tier price) and the extra-worker line. */
export function splitProItems(
  items: ReadonlyArray<ProItem>,
  tierOfPrice: (priceId: string) => ProTier | null,
  isExtraPrice: (priceId: string) => boolean
): { plan: ProItem | null; tier: ProTier | null; extra: ProItem | null } {
  let plan: ProItem | null = null;
  let tier: ProTier | null = null;
  let extra: ProItem | null = null;
  for (const item of items) {
    const t = tierOfPrice(item.priceId);
    if (t && !plan) {
      plan = item;
      tier = t;
    } else if (isExtraPrice(item.priceId) && !extra) {
      extra = item;
    }
  }
  return { plan, tier, extra };
}

export type ProLine = { label: string; quantity: number; unitPence: number; totalPence: number };

/** The lines of the monthly bill and their total (before any one-off proration). */
export function proBreakdown(p: {
  tierName: string;
  planUnitPence: number;
  extraQuantity: number;
  extraUnitPence: number;
}): { lines: ProLine[]; monthlyPence: number } {
  const lines: ProLine[] = [
    { label: `${p.tierName} plan`, quantity: 1, unitPence: p.planUnitPence, totalPence: p.planUnitPence },
  ];
  const extras = Math.max(0, Math.floor(p.extraQuantity));
  if (extras > 0) {
    lines.push({
      label: 'Extra workers',
      quantity: extras,
      unitPence: p.extraUnitPence,
      totalPence: extras * p.extraUnitPence,
    });
  }
  return { lines, monthlyPence: lines.reduce((sum, l) => sum + l.totalPence, 0) };
}

function money(pence: number): string {
  const whole = Math.floor(pence / 100);
  const rest = pence % 100;
  const grouped = whole.toLocaleString('en-GB');
  return rest === 0 ? `£${grouped}` : `£${grouped}.${String(rest).padStart(2, '0')}`;
}

/** The sentence under the team bar on the Plan & billing tab. */
export function teamNote(p: {
  over: number;
  included: number;
  /** One extra worker's price in pence for the plan's interval. */
  unitPence: number;
  interval: 'month' | 'year';
}): string {
  const unit = money(p.unitPence);
  if (p.interval === 'year') {
    const lead = p.over > 0 ? '' : `You only pay for workers beyond the ${p.included} included. `;
    return `${lead}Each extra worker is ${unit} a year. Add one part-way through the year and you pay only for the months left, straight away. Remove one and the unused part comes back as credit.`;
  }
  return p.over > 0
    ? `Each extra worker is ${unit} a month, billed with your plan. Removing someone from the team lowers your next bill.`
    : `You only pay for workers beyond the ${p.included} included. Each extra worker is ${unit} a month, and you're asked before it's added.`;
}
