import { describe, expect, it } from 'vitest';
import {
  PRO_SIDEBAR_WORDING,
  creditEarnedPence,
  proHowItWorks,
  proReferralStatus,
  proShareMessage,
} from '@/components/referrals/pro-referral-copy';

describe('proShareMessage', () => {
  it('is the exact sentence with the link', () => {
    expect(proShareMessage('https://app.test/r/ABCD2345')).toBe(
      'I run my team on WorkWise Pro. Have a look: https://app.test/r/ABCD2345',
    );
  });
});

describe('proReferralStatus', () => {
  it('says what a rewarded row earned, with the date', () => {
    expect(proReferralStatus({ status: 'rewarded', rewardPence: 14900, rewardedAt: '2026-11-12T09:00:00Z' })).toEqual({
      label: '£149 credit added 12 Nov',
      tone: 'emerald',
    });
  });

  it('falls back to a plain label without an amount or date', () => {
    expect(proReferralStatus({ status: 'rewarded', rewardPence: null, rewardedAt: null })).toEqual({
      label: 'Credit added',
      tone: 'emerald',
    });
  });

  it('waiting and rewarding wait for payments; void did not qualify', () => {
    for (const status of ['waiting', 'rewarding'] as const) {
      expect(proReferralStatus({ status, rewardPence: null, rewardedAt: null })).toEqual({
        label: 'Waiting for their payments',
        tone: 'amber',
      });
    }
    expect(proReferralStatus({ status: 'void', rewardPence: null, rewardedAt: null })).toEqual({
      label: "Didn't qualify",
      tone: 'slate',
    });
  });
});

describe('proHowItWorks', () => {
  it('is four steps with the exact titles and the honest "up to" amount', () => {
    const steps = proHowItWorks(44900);
    expect(steps.map((s) => s.title)).toEqual([
      'Share your link',
      'They sign up and pay the normal price',
      "Once they're settled in, you're credited",
      'One month of the cheaper plan',
    ]);
    expect(steps[3].text).toContain('up to £449');
  });
});

describe('creditEarnedPence', () => {
  it('adds up only rewarded rows', () => {
    expect(
      creditEarnedPence([
        { status: 'rewarded', rewardPence: 14900 },
        { status: 'rewarded', rewardPence: 3500 },
        { status: 'waiting', rewardPence: 99999 },
        { status: 'void', rewardPence: null },
        { status: 'rewarded', rewardPence: null },
      ]),
    ).toBe(18400);
    expect(creditEarnedPence([])).toBe(0);
  });
});

describe('no promise to the friend (D3)', () => {
  it('never says free, discount, off or both', () => {
    const strings = [
      proShareMessage('https://app.test/r/ABCD2345'),
      ...proHowItWorks(14900).flatMap((s) => [s.title, s.text]),
      ...(['waiting', 'rewarding', 'rewarded', 'void'] as const).map(
        (status) => proReferralStatus({ status, rewardPence: 14900, rewardedAt: '2026-11-12T09:00:00Z' }).label,
      ),
      ...Object.values(PRO_SIDEBAR_WORDING),
    ];
    for (const text of strings) {
      // Two agreed phrases are not promises: the referrer's own credit, and the plain statement that there is no discount
      const checked = text.replace('taken off your next bill', '').replace("There's no discount for them", '');
      expect(checked).not.toMatch(/\bfree\b|discount|\boff\b|\bboth\b/i);
    }
  });
});
