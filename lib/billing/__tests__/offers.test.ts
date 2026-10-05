import { describe, expect, it } from 'vitest';
import {
  chooseSignupOffer,
  couponIdFor,
  fallbackAfterFoundingRefused,
  FOUNDING_PLACES,
  normaliseReferralCode,
  offerView,
  type FoundingStatus,
} from '@/lib/billing/offers';
import type { BillingInterval, PlanKey } from '@/lib/billing/plans';

const active: FoundingStatus = { active: true, placesLeft: 200, places: FOUNDING_PLACES };
const ended: FoundingStatus = { active: false, placesLeft: 0, places: FOUNDING_PLACES };
const unknown: FoundingStatus = { active: null, placesLeft: null, places: FOUNDING_PLACES };

function choice(plan: PlanKey, interval: BillingInterval) {
  return { plan, interval };
}

describe('normaliseReferralCode', () => {
  it('uppercases a valid code and rejects lookalike characters', () => {
    expect(normaliseReferralCode(' abcd2345 ')).toBe('ABCD2345');
    expect(normaliseReferralCode('abcd2345')).toBe('ABCD2345');
    expect(normaliseReferralCode('ABCD2340')).toBeNull();
    expect(normaliseReferralCode('ABCDO234')).toBeNull();
    expect(normaliseReferralCode('ABCD234')).toBeNull();
    expect(normaliseReferralCode(null)).toBeNull();
  });
});

describe('chooseSignupOffer', () => {
  const foundingStates = [
    ['active', active],
    ['ended', ended],
    ['unknown', unknown],
  ] as const;
  const plans: PlanKey[] = ['rounds', 'both'];

  it('covers monthly and yearly, founding on or off, referred or not', () => {
    for (const plan of plans) {
      for (const [label, founding] of foundingStates) {
        for (const referred of [true, false]) {
          const monthly = chooseSignupOffer({ choice: choice(plan, 'month'), founding, referred });
          const yearly = chooseSignupOffer({ choice: choice(plan, 'year'), founding, referred });

          if (label === 'ended') {
            expect(monthly.offer).toBe(referred ? 'free_month' : 'none');
            expect(monthly.secondMonthHalf).toBe(false);
          } else if (referred) {
            // Referred during founding: month 1 free, month 2 half price (added after the first invoice).
            expect(monthly.offer).toBe('free_month');
            expect(monthly.couponEnv).toBe('STRIPE_COUPON_REFERRAL_MONTH');
            expect(monthly.secondMonthHalf).toBe(true);
            expect(offerView(monthly)).toBe('free_then_half');
          } else {
            expect(monthly.offer).toBe('founding');
            expect(monthly.couponEnv).toBe('STRIPE_COUPON_FOUNDING');
            expect(monthly.secondMonthHalf).toBe(false);
          }
          if (referred) {
            expect(yearly.offer).toBe('month_off_year');
            expect(yearly.couponEnv).toBe(
              plan === 'both' ? 'STRIPE_COUPON_REFERRAL_YEAR_59' : 'STRIPE_COUPON_REFERRAL_YEAR_35'
            );
          } else {
            expect(yearly.offer).toBe('none');
            expect(yearly.headline).toBeNull();
          }
        }
      }
    }
  });

  it('uses the plan prices in the headlines', () => {
    const rounds = chooseSignupOffer({ choice: choice('rounds', 'month'), founding: active, referred: true });
    expect(rounds.headline).toBe(
      'Your first month is free, your second is half price (£17.50), then £35 a month.'
    );

    const free = chooseSignupOffer({ choice: choice('lite', 'month'), founding: ended, referred: true });
    expect(free.headline).toBe('Your first month is free, then £35 a month.');

    const year = chooseSignupOffer({ choice: choice('rounds', 'year'), founding: active, referred: true });
    expect(year.headline).toBe('£35 off your first year: £315 today, then £350 a year.');

    const both = chooseSignupOffer({ choice: choice('both', 'year'), founding: ended, referred: true });
    expect(both.headline).toBe('£59 off your first year: £531 today, then £590 a year.');

    const bothFounding = chooseSignupOffer({ choice: choice('both', 'month'), founding: unknown, referred: false });
    const bothReferred = chooseSignupOffer({ choice: choice('both', 'month'), founding: unknown, referred: true });
    expect(bothReferred.headline).toBe(
      'Your first month is free, your second is half price (£29.50), then £59 a month.'
    );
    expect(bothFounding.headline).toBe(
      'Founding offer: half price for your first 2 months (£29.50), then £59 a month.'
    );
  });
});

describe('fallbackAfterFoundingRefused', () => {
  it('drops founding and keeps a referral discount when there is one', () => {
    expect(fallbackAfterFoundingRefused({ choice: choice('rounds', 'month'), referred: true }).offer).toBe('free_month');
    expect(fallbackAfterFoundingRefused({ choice: choice('rounds', 'month'), referred: false }).offer).toBe('none');
    expect(fallbackAfterFoundingRefused({ choice: choice('both', 'year'), referred: true }).couponEnv).toBe(
      'STRIPE_COUPON_REFERRAL_YEAR_59'
    );
    expect(fallbackAfterFoundingRefused({ choice: choice('lite', 'year'), referred: false })).toEqual({
      offer: 'none',
      secondMonthHalf: false,
      couponEnv: null,
      headline: null,
    });
  });
});

describe('couponIdFor', () => {
  it('returns null when there is no coupon and throws when the env is missing', () => {
    expect(couponIdFor({ offer: 'none', secondMonthHalf: false, couponEnv: null, headline: null })).toBeNull();
    const previous = process.env.STRIPE_COUPON_FOUNDING;
    delete process.env.STRIPE_COUPON_FOUNDING;
    expect(() =>
      couponIdFor({
        offer: 'founding',
        secondMonthHalf: false,
        couponEnv: 'STRIPE_COUPON_FOUNDING',
        headline: 'x',
      })
    ).toThrow('Missing STRIPE_COUPON_FOUNDING');
    if (previous === undefined) delete process.env.STRIPE_COUPON_FOUNDING;
    else process.env.STRIPE_COUPON_FOUNDING = previous;
  });
});
