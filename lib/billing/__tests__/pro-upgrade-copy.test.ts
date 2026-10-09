import { describe, expect, it } from 'vitest';
import { upgradeCardLines, upgradeDialogLines } from '@/lib/billing/pro-upgrade-copy';

describe('upgradeCardLines', () => {
  it('Starter → Growth at team 8: no extras today', () => {
    expect(upgradeCardLines({ from: 'starter', to: 'growth', interval: 'month', team: 8 })).toMatchObject({
      title: 'Growth',
      priceLine: '£449 a month',
      includedLine: '35 workers included (you have 8)',
      extraLine: 'Extra workers £9 a month each',
      effectLine: 'You have no extra workers today.',
    });
  });

  it('says what the bigger plan does to the bill for this team', () => {
    const more = upgradeCardLines({ from: 'starter', to: 'growth', interval: 'month', team: 8 });
    expect(more).toMatchObject({ roomLine: 'Room for 35 workers', nowPence: 14900, afterPence: 44900, deltaTone: 'more', hasExtrasEffect: false });
    expect(more.deltaLine).toBe('+£300 a month for room to grow');
    // Team 40 on Starter pays 149 + 30 × 12 = £509; Growth is 449 + 5 × 9 = £494.
    const save = upgradeCardLines({ from: 'starter', to: 'growth', interval: 'month', team: 40 });
    expect(save).toMatchObject({ nowPence: 50900, afterPence: 49400, deltaTone: 'save', hasExtrasEffect: true });
    expect(save.deltaLine).toBe('Saves you £15 a month');
  });

  it('team 20: the extras are covered by the bigger plan', () => {
    expect(upgradeCardLines({ from: 'starter', to: 'growth', interval: 'month', team: 20 }).effectLine).toBe(
      'Your 10 extra workers (£120 a month) are covered by the bigger plan.',
    );
  });

  it('team 40: the extras shrink', () => {
    expect(upgradeCardLines({ from: 'starter', to: 'growth', interval: 'month', team: 40 }).effectLine).toBe('Your extras drop from 30 to 5.');
  });

  it('yearly uses yearly figures', () => {
    const lines = upgradeCardLines({ from: 'growth', to: 'pro', interval: 'year', team: 50 });
    expect(lines.priceLine).toBe('£7,490 a year');
    expect(lines.extraLine).toBe('Extra workers £60 a year each');
    expect(lines.effectLine).toBe('Your 15 extra workers (£1,350 a year) are covered by the bigger plan.');
  });

  it('singular', () => {
    expect(upgradeCardLines({ from: 'starter', to: 'growth', interval: 'month', team: 11 }).effectLine).toBe(
      'Your 1 extra worker (£12 a month) is covered by the bigger plan.',
    );
  });
});

describe('upgradeDialogLines', () => {
  const base = { target: 'growth' as const, thenLabel: '£449 a month', renewsOn: '2026-11-08T12:00:00.000Z', overAfter: 0, includedAfter: 35 };

  it('shows today\'s charge, what renews, and the button with the same figure', () => {
    expect(upgradeDialogLines({ ...base, todayPence: 30000 })).toEqual({
      todayLine: 'Today you pay £300',
      thenLine: 'then £449 a month from 8 Nov',
      extrasLine: 'Your plan now includes 35 workers, so you have no extra workers.',
      button: 'Upgrade and pay £300',
    });
  });

  it('says nothing to pay when the change costs nothing today', () => {
    const lines = upgradeDialogLines({ ...base, todayPence: 0, overAfter: 5 });
    expect(lines.todayLine).toBe('Nothing to pay today');
    expect(lines.button).toBe('Upgrade to Growth');
    expect(lines.extrasLine).toBe("You'll have 5 extra workers beyond the 35 included.");
  });

  it('the figure in the text equals the figure on the button', () => {
    const lines = upgradeDialogLines({ ...base, todayPence: 12345 });
    expect(lines.todayLine).toContain('£123.45');
    expect(lines.button).toContain('£123.45');
  });
});
