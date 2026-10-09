/** Pure rules for changing a Pro plan. No Stripe, no database. */

export type UpgradeItem =
  | { id: string; price: string } // the plan line: the new price, quantity stays 1
  | { id: string; price: string; quantity: number } // the extra-worker line: new price and new quantity
  | { id: string; deleted: true } // the extra-worker line is no longer needed
  | { price: string; quantity: number }; // an extra-worker line to add (only when there was none)

/** Workers over the target tier's allowance for a team of this size: max(0, team − included). */
export function overAfterUpgrade(teamSize: number, targetIncluded: number): number {
  return Math.max(0, Math.floor(teamSize) - targetIncluded);
}

/**
 * The items for subscriptions.update AND invoices.createPreview (same shape, so the preview shows exactly what the
 * change does). Moving up a tier raises the included workers, so the extra-worker line shrinks or goes away in the
 * same call.
 */
export function buildUpgradeItems(input: {
  planItemId: string;
  extraItemId: string | null;
  targetPlanPriceId: string;
  /** null only when `newOver` is 0. */
  targetExtraPriceId: string | null;
  newOver: number;
}): UpgradeItem[] {
  const items: UpgradeItem[] = [{ id: input.planItemId, price: input.targetPlanPriceId }];
  if (input.newOver > 0) {
    if (!input.targetExtraPriceId) throw new Error('missing extra-worker price for the target tier');
    items.push(
      input.extraItemId
        ? { id: input.extraItemId, price: input.targetExtraPriceId, quantity: input.newOver }
        : { price: input.targetExtraPriceId, quantity: input.newOver },
    );
  } else if (input.extraItemId) {
    items.push({ id: input.extraItemId, deleted: true });
  }
  return items;
}

/**
 * The items for switching a monthly Pro plan to yearly (subscriptions.update AND invoices.createPreview). The plan
 * line moves to the yearly price; the extra-worker line, if there is one, moves to the yearly extra price and keeps
 * its quantity. The team doesn't change, only the way it is billed.
 */
export function buildYearlyItems(input: {
  planItemId: string;
  yearlyPlanPriceId: string;
  extraItemId: string | null;
  extraQuantity: number;
  /** null only when there is no extra-worker line. */
  yearlyExtraPriceId: string | null;
}): UpgradeItem[] {
  const items: UpgradeItem[] = [{ id: input.planItemId, price: input.yearlyPlanPriceId }];
  if (input.extraItemId && input.extraQuantity > 0) {
    if (!input.yearlyExtraPriceId) throw new Error('missing yearly extra-worker price');
    items.push({ id: input.extraItemId, price: input.yearlyExtraPriceId, quantity: input.extraQuantity });
  }
  return items;
}

/** What a switch to yearly means in pounds, for this tier and this many extra workers (all pence). */
export function yearlySwitchFigures(input: {
  planMonthlyPence: number;
  extraMonthlyPence: number;
  planYearlyPence: number;
  extraYearlyPence: number;
  extras: number;
}): { monthlyPence: number; yearlyPence: number; yearOfMonthsPence: number; savesPence: number } {
  const extras = Math.max(0, Math.floor(input.extras));
  const monthlyPence = input.planMonthlyPence + extras * input.extraMonthlyPence;
  const yearlyPence = input.planYearlyPence + extras * input.extraYearlyPence;
  const yearOfMonthsPence = monthlyPence * 12;
  return { monthlyPence, yearlyPence, yearOfMonthsPence, savesPence: yearOfMonthsPence - yearlyPence };
}
