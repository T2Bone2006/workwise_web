import { describe, expect, it } from 'vitest';
import {
  computeAllowance,
  noticeForBatch,
  noticeForNextWorker,
  noticeSentence,
  usageLine,
} from '@/lib/billing/pro-allowance';

const starter = (used: number, extra: Partial<Parameters<typeof computeAllowance>[0]> = {}) =>
  computeAllowance({ tier: 'starter', source: 'stripe', includedOverride: null, used, ...extra });

describe('computeAllowance', () => {
  it('uses the tier defaults', () => {
    expect(starter(3).included).toBe(10);
    expect(computeAllowance({ tier: 'growth', source: 'stripe', includedOverride: null, used: 1 }).included).toBe(35);
    expect(computeAllowance({ tier: 'pro', source: 'stripe', includedOverride: null, used: 1 }).included).toBe(70);
  });

  it('counts workers over the allowance', () => {
    expect(starter(10).over).toBe(0);
    expect(starter(12).over).toBe(2);
  });

  it('applies a custom included count', () => {
    const a = starter(12, { includedOverride: 15 });
    expect(a.included).toBe(15);
    expect(a.over).toBe(0);
  });

  it('ignores a nonsense override', () => {
    expect(starter(1, { includedOverride: -3 }).included).toBe(10);
    expect(starter(1, { includedOverride: 2.5 }).included).toBe(10);
  });

  it('never limits a manual account, override or not', () => {
    const a = starter(80, { source: 'manual' });
    expect(a.limited).toBe(false);
    expect(a.over).toBe(0);
    expect(starter(80, { source: 'manual', includedOverride: 5 }).limited).toBe(false);
  });
});

describe('noticeForNextWorker', () => {
  it('lets the last included worker through', () => {
    expect(noticeForNextWorker(starter(9))).toBeNull();
  });

  it('asks about the first worker over the line', () => {
    const n = noticeForNextWorker(starter(10));
    expect(n).toEqual({
      tierName: 'Starter',
      workerNumber: 11,
      included: 10,
      extraWorkerPounds: 12,
      extrasAfter: 1,
      interval: 'month',
      perWorkerPence: 1200,
    });
  });

  it('asks again for every worker already over', () => {
    expect(noticeForNextWorker(starter(14))?.workerNumber).toBe(15);
    expect(noticeForNextWorker(starter(14))?.extrasAfter).toBe(5);
  });

  it('respects the override', () => {
    expect(noticeForNextWorker(starter(10, { includedOverride: 15 }))).toBeNull();
    expect(noticeForNextWorker(starter(15, { includedOverride: 15 }))?.workerNumber).toBe(16);
  });

  it('never asks a manual account', () => {
    expect(noticeForNextWorker(starter(500, { source: 'manual' }))).toBeNull();
  });
});

describe('wording', () => {
  it('writes ordinals correctly', () => {
    const sentence = (n: number) =>
      noticeSentence({ tierName: 'Starter', workerNumber: n, included: 10, extraWorkerPounds: 12, extrasAfter: n - 10, interval: 'month', perWorkerPence: 1200 });
    expect(sentence(11)).toContain('11th worker');
    expect(sentence(21)).toContain('21st worker');
    expect(sentence(22)).toContain('22nd worker');
    expect(sentence(23)).toContain('23rd worker');
    expect(sentence(112)).toContain('112th worker');
    expect(sentence(11)).toBe(
      'This is your 11th worker. Your Starter plan includes 10. Each extra worker is £12 a month.',
    );
  });

  it('shows usage, with the extra cost when over, and nothing for manual', () => {
    expect(usageLine(starter(8))).toBe('8 / 10 workers');
    expect(usageLine(starter(12))).toBe('12 workers');
    expect(usageLine(starter(8, { source: 'manual' }))).toBeNull();
  });
});

describe('noticeForBatch', () => {
  it('is null when the batch fits inside the allowance, including the exact boundary', () => {
    expect(noticeForBatch(starter(0), 10)).toBeNull();
    expect(noticeForBatch(starter(5), 5)).toBeNull();
  });

  it('shows the total effect on the bill of one more than the boundary', () => {
    expect(noticeForBatch(starter(10), 1)).toMatchObject({ teamBefore: 10, teamAfter: 11, extrasBefore: 0, extrasAfter: 1, newExtras: 1 });
  });

  it('counts a big batch on a Starter team: team 8 adding 40', () => {
    expect(noticeForBatch(starter(8), 40)).toEqual({
      tier: 'starter',
      tierName: 'Starter',
      included: 10,
      teamBefore: 8,
      adding: 40,
      teamAfter: 48,
      extrasBefore: 0,
      extrasAfter: 38,
      newExtras: 38,
      extraWorkerPounds: 12,
    });
  });

  it('only counts the new extras when the team is already over', () => {
    expect(noticeForBatch(starter(12), 3)).toMatchObject({ extrasBefore: 2, extrasAfter: 5, newExtras: 3 });
  });

  it('is null for a manual account, and for nothing or nonsense', () => {
    expect(noticeForBatch(starter(500, { source: 'manual' }), 40)).toBeNull();
    expect(noticeForBatch(starter(10), 0)).toBeNull();
    expect(noticeForBatch(starter(10), -3)).toBeNull();
    expect(noticeForBatch(starter(10), Number.NaN)).toBeNull();
  });
});

describe('yearly wording', () => {
  const yearly = (used: number) => computeAllowance({ tier: 'starter', source: 'stripe', includedOverride: null, used, interval: 'year' });

  it('the notice carries the yearly price and interval', () => {
    expect(noticeForNextWorker(yearly(10))).toMatchObject({ interval: 'year', perWorkerPence: 12000, extraWorkerPounds: 12 });
    expect(noticeForNextWorker(starter(10))).toMatchObject({ interval: 'month', perWorkerPence: 1200 });
    expect(noticeForNextWorker({ ...starter(10), interval: null })).toMatchObject({ interval: 'month' });
  });

  it('the sentence says what a yearly extra worker costs and when', () => {
    const n = noticeForNextWorker(yearly(10))!;
    expect(noticeSentence(n)).toBe(
      'This is your 11th worker. Your Starter plan includes 10. Each extra worker is £120 a year, charged for the months you have left.',
    );
  });

  it('monthly wording is exactly as before', () => {
    expect(noticeSentence(noticeForNextWorker(starter(10))!)).toBe(
      'This is your 11th worker. Your Starter plan includes 10. Each extra worker is £12 a month.',
    );
    expect(usageLine(starter(12))).toBe('12 workers');
  });

  it('the usage line shows the annual extra cost for a yearly business', () => {
    expect(usageLine(yearly(12))).toBe('12 workers');
    expect(usageLine(yearly(8))).toBe('8 / 10 workers');
  });

  it('an unknown interval reads as monthly', () => {
    expect(usageLine({ ...starter(12), interval: null })).toBe('12 workers');
  });
});


describe('extras already paid for at sign-up', () => {
  const growth = (used: number, paidFor: number | null) =>
    computeAllowance({ tier: 'growth', source: 'stripe', includedOverride: null, used, paidFor });

  it('adds no charge for workers up to the size paid for', () => {
    expect(noticeForNextWorker(growth(35, 40))).toBeNull();
    expect(noticeForNextWorker(growth(38, 40))).toBeNull();
  });

  it('asks again for the worker beyond the size paid for', () => {
    expect(noticeForNextWorker(growth(40, 40))).toMatchObject({ workerNumber: 41, extrasAfter: 6 });
    expect(noticeForNextWorker(growth(39, 40))).toBeNull();
  });

  it('a batch inside the paid size needs no confirmation', () => {
    expect(noticeForBatch(growth(0, 40), 40)).toBeNull();
  });

  it('a batch past the paid size confirms only the new extras', () => {
    expect(noticeForBatch(growth(0, 40), 45)).toMatchObject({ extrasBefore: 5, extrasAfter: 10, newExtras: 5 });
  });

  it('the usage line counts the paid-for extras as part of the plan', () => {
    expect(usageLine(growth(0, 40))).toBe('0 / 40 workers');
    expect(usageLine(growth(38, 40))).toBe('38 / 40 workers');
    expect(usageLine(growth(40, null))).toBe('40 workers');
    expect(usageLine(growth(41, 40))).toBe('41 workers');
    expect(usageLine(growth(33, null))).toBe('33 / 35 workers');
    expect(usageLine(growth(35, null))).toBe('35 / 35 workers');
  });
});
