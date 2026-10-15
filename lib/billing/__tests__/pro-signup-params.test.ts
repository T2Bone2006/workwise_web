import { describe, expect, it } from 'vitest';
import { parseProSignupParams } from '@/lib/billing/pro-signup-params';

describe('parseProSignupParams', () => {
  it('uses growth, monthly, and the tier\'s included workers when nothing is given', () => {
    expect(parseProSignupParams({})).toEqual({ choice: { tier: 'growth', interval: 'month' }, workers: 35, canceled: false, ref: null });
  });

  it('keeps a valid tier, interval and worker number', () => {
    const p = parseProSignupParams({ tier: 'starter', interval: 'year', workers: '8' });
    expect(p.choice).toEqual({ tier: 'starter', interval: 'year' });
    expect(p.workers).toBe(8);
  });

  it('picks the cheapest tier for the workers when the tier is missing or unknown', () => {
    expect(parseProSignupParams({ workers: '40' }).choice.tier).toBe('growth');
    expect(parseProSignupParams({ workers: '10' }).choice.tier).toBe('starter');
    expect(parseProSignupParams({ workers: '80', tier: 'enterprise' }).choice.tier).toBe('pro');
  });

  it('treats garbage workers as missing and clamps large ones', () => {
    expect(parseProSignupParams({ tier: 'pro', workers: 'abc' }).workers).toBe(70);
    expect(parseProSignupParams({ tier: 'pro', workers: '0' }).workers).toBe(70);
    expect(parseProSignupParams({ tier: 'pro', workers: '-4' }).workers).toBe(70);
    expect(parseProSignupParams({ tier: 'pro', workers: '5000' }).workers).toBe(999);
  });

  it('reads ?plan= as the tier and falls back from unknown intervals', () => {
    expect(parseProSignupParams({ plan: 'pro', interval: 'weekly' }).choice).toEqual({ tier: 'pro', interval: 'month' });
  });

  it('normalises the referral code and notes a cancelled payment', () => {
    expect(parseProSignupParams({ ref: ' abcd2345 ' }).ref).toBe('ABCD2345');
    expect(parseProSignupParams({ ref: 'bad' }).ref).toBeNull();
    expect(parseProSignupParams({ canceled: '1' }).canceled).toBe(true);
  });
});
