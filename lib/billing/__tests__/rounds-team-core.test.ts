import { describe, expect, it } from 'vitest';
import {
  ROUNDS_TEAM_MONTHLY_PENCE,
  ROUNDS_TEAM_YEARLY_PENCE,
  TEAM_HELPERS_FREE,
  TEAM_PRICE_LINE,
  TEAM_PRICE_LINE_YEARLY,
  isRoundsTeamPrice,
  leadsToBill,
  teamPriceEnv,
  teamPriceIdFor,
  teamPricePence,
  teamPriceSentence,
} from '@/lib/billing/rounds-team-core';

describe('prices and wording', () => {
  it('is £10 a month and £100 a year (10 × monthly)', () => {
    expect(ROUNDS_TEAM_MONTHLY_PENCE).toBe(1000);
    expect(ROUNDS_TEAM_YEARLY_PENCE).toBe(10000);
    expect(ROUNDS_TEAM_YEARLY_PENCE).toBe(ROUNDS_TEAM_MONTHLY_PENCE * 10);
    expect(teamPricePence('month')).toBe(1000);
    expect(teamPricePence('year')).toBe(10000);
  });

  it('uses the owner’s exact wording and never "+ VAT"', () => {
    expect(TEAM_PRICE_LINE).toBe('£10 a month per extra worker, VAT included where applicable');
    expect(TEAM_PRICE_LINE_YEARLY).toBe('£100 a year per extra worker, VAT included where applicable');
    expect(TEAM_HELPERS_FREE).toBe('Helpers without a login are free.');
    expect(`${TEAM_PRICE_LINE}${TEAM_PRICE_LINE_YEARLY}`).not.toMatch(/\+\s*VAT/);
    expect(teamPriceSentence('month')).toBe(TEAM_PRICE_LINE);
    expect(teamPriceSentence('year')).toBe(TEAM_PRICE_LINE_YEARLY);
  });
});

describe('price ids from the environment', () => {
  const env = { STRIPE_PRICE_ROUNDS_TEAM_MONTHLY: 'price_m', STRIPE_PRICE_ROUNDS_TEAM_YEARLY: ' price_y ' };

  it('reads the two names', () => {
    expect(teamPriceEnv('month')).toBe('STRIPE_PRICE_ROUNDS_TEAM_MONTHLY');
    expect(teamPriceEnv('year')).toBe('STRIPE_PRICE_ROUNDS_TEAM_YEARLY');
    expect(teamPriceIdFor('month', env)).toBe('price_m');
    expect(teamPriceIdFor('year', env)).toBe('price_y');
  });

  it('is null when unset or blank', () => {
    expect(teamPriceIdFor('month', {})).toBeNull();
    expect(teamPriceIdFor('year', { STRIPE_PRICE_ROUNDS_TEAM_YEARLY: '  ' })).toBeNull();
  });

  it('recognises only the two team prices, and nothing when unset', () => {
    expect(isRoundsTeamPrice('price_m', env)).toBe(true);
    expect(isRoundsTeamPrice('price_y', env)).toBe(true);
    expect(isRoundsTeamPrice('price_plan', env)).toBe(false);
    expect(isRoundsTeamPrice(null, env)).toBe(false);
    expect(isRoundsTeamPrice(undefined, env)).toBe(false);
    expect(isRoundsTeamPrice('', {})).toBe(false);
    expect(isRoundsTeamPrice('anything', {})).toBe(false);
  });
});

describe('leadsToBill', () => {
  it('is one line per lead and never negative or fractional', () => {
    expect(leadsToBill(0)).toBe(0);
    expect(leadsToBill(3)).toBe(3);
    expect(leadsToBill(-2)).toBe(0);
    expect(leadsToBill(2.9)).toBe(2);
    expect(leadsToBill(Number.NaN)).toBe(0);
  });
});
