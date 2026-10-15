/**
 * Pure rules for the "Rounds team member" line on a Rounds business's Stripe subscription (Phase 9, D15).
 * £10 a month per lead (a person with a login); £100 a year (10 × monthly); helpers cost nothing.
 * No Stripe, no database: the Stripe side is rounds-team.ts.
 */

export const ROUNDS_TEAM_MONTHLY_PENCE = 1000;
export const ROUNDS_TEAM_YEARLY_PENCE = 10000;

export type TeamInterval = 'month' | 'year';

/** The exact wording used on Rounds screens and the marketing site (VAT included where applicable; not "+ VAT"). */
export const TEAM_PRICE_LINE = '£10 a month per extra worker, VAT included where applicable';
export const TEAM_PRICE_LINE_YEARLY = '£100 a year per extra worker, VAT included where applicable';
/** Yearly is 10 × monthly, so each extra worker is 2 months free: £100 a year instead of £120. */
export const TEAM_YEARLY_OFFER = '2 months free when you pay yearly: £100 a year instead of £120 for each extra worker.';
export const TEAM_YEARLY_ACTIVE = '2 months free: you pay £100 a year instead of £120 for each extra worker.';
export const TEAM_HELPERS_FREE = 'Helpers without a login are free.';

export function teamPriceEnv(interval: TeamInterval): string {
  return interval === 'year' ? 'STRIPE_PRICE_ROUNDS_TEAM_YEARLY' : 'STRIPE_PRICE_ROUNDS_TEAM_MONTHLY';
}

export function teamPricePence(interval: TeamInterval): number {
  return interval === 'year' ? ROUNDS_TEAM_YEARLY_PENCE : ROUNDS_TEAM_MONTHLY_PENCE;
}

/** The Stripe price id for an interval, or null when the environment variable is not set. */
export function teamPriceIdFor(interval: TeamInterval, env: Record<string, string | undefined> = process.env): string | null {
  const value = env[teamPriceEnv(interval)];
  return value && value.trim() !== '' ? value.trim() : null;
}

/** True when the id is one of the two team prices (false for anything else, and when neither is configured). */
export function isRoundsTeamPrice(priceId: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!priceId) return false;
  return priceId === teamPriceIdFor('month', env) || priceId === teamPriceIdFor('year', env);
}

/** How many team lines to bill: one per lead. Never negative, never fractional. */
export function leadsToBill(leadCount: number): number {
  return Number.isFinite(leadCount) ? Math.max(0, Math.floor(leadCount)) : 0;
}

/** A lead's price as the owner reads it. */
export function teamPriceSentence(interval: TeamInterval): string {
  return interval === 'year' ? TEAM_PRICE_LINE_YEARLY : TEAM_PRICE_LINE;
}
