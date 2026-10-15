import { describe, expect, it } from 'vitest';
import { noticeFigures } from '@/components/workers/extra-worker-confirm-dialog';
import { computeAllowance, noticeForNextWorker, type ExtraWorkerNotice } from '@/lib/billing/pro-allowance';

function notice(interval: 'month' | 'year', used = 10, extra: Partial<ExtraWorkerNotice> = {}): ExtraWorkerNotice {
  const n = noticeForNextWorker(computeAllowance({ tier: 'starter', source: 'stripe', includedOverride: null, used, interval }));
  if (!n) throw new Error('expected a notice');
  return { ...n, ...extra };
}

describe('noticeFigures', () => {
  it('monthly is exactly as it always was', () => {
    expect(noticeFigures(notice('month'))).toEqual({
      yearly: false,
      billed: 'monthly',
      headline: '+£12',
      small: 'a month',
      then: null,
      total: '1 × £12 = £12',
      button: '£12 a month',
      credit: null,
    });
    expect(noticeFigures(notice('month', 13)).total).toBe('4 × £12 = £48');
  });

  it('yearly with Stripe\'s figure: what is charged now, then the yearly price, and the credit promise', () => {
    expect(noticeFigures(notice('year', 10, { chargeNowPence: 5836 }))).toEqual({
      yearly: true,
      billed: 'yearly',
      headline: '£58.36 now',
      small: 'for the rest of your year',
      then: 'then £120 a year',
      total: '1 × £120 = £120 a year',
      button: '£58.36 now',
      credit: 'Remove a worker later and the unused part comes back as credit on your account.',
    });
  });

  it('yearly without a figure: the yearly price, charged for the months left', () => {
    const f = noticeFigures(notice('year', 10, { chargeNowPence: null }));
    expect(f).toMatchObject({ headline: '£120 a year', small: 'charged for the months you have left', button: '£120 a year', then: null });
  });

  it('never shows a monthly price to a yearly business', () => {
    const f = noticeFigures(notice('year', 12, { chargeNowPence: 9000 }));
    expect(JSON.stringify(f)).not.toContain('a month');
    expect(f.total).toBe('3 × £120 = £360 a year');
  });
});
