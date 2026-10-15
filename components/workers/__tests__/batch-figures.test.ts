import { describe, expect, it } from 'vitest';
import { batchFigures } from '@/components/workers/batch-confirm-dialog';
import { computeAllowance, noticeForBatch, type BatchNotice } from '@/lib/billing/pro-allowance';

function notice(tier: 'starter' | 'growth' | 'pro', used: number, adding: number): BatchNotice {
  const n = noticeForBatch(computeAllowance({ tier, source: 'stripe', includedOverride: null, used }), adding);
  if (!n) throw new Error('expected a notice');
  return n;
}

describe('batchFigures', () => {
  it('monthly: the new extras at the monthly price, and the total', () => {
    const f = batchFigures(notice('growth', 35, 5), 'month', null);
    expect(f).toMatchObject({ yearly: false, headline: '+£45', small: 'a month', button: '£45 a month', total: '5 × £9 = £45 a month' });
  });

  it('monthly is the default when the interval is unknown', () => {
    expect(batchFigures(notice('starter', 8, 40), null, null).headline).toBe('+£456');
  });

  it('yearly with Stripe\'s figure: shows exactly that now, then the yearly total', () => {
    const f = batchFigures(notice('starter', 10, 3), 'year', 5836);
    expect(f).toMatchObject({
      yearly: true,
      headline: '£58.36 now',
      small: 'for the rest of your year',
      then: 'then £360 a year',
      button: '£58.36 now',
      total: '3 × £120 = £360 a year',
    });
  });

  it('yearly without a figure: the yearly price for the new extras, charged for the months left', () => {
    const f = batchFigures(notice('starter', 10, 3), 'year', null);
    expect(f).toMatchObject({ headline: '£360 a year', small: 'charged for the months you have left', button: '£360 a year' });
  });

  it('counts only the new extras when some were already there', () => {
    const f = batchFigures(notice('starter', 12, 3), 'month', null);
    expect(f.headline).toBe('+£36');
    expect(f.total).toBe('5 × £12 = £60 a month');
  });
});
