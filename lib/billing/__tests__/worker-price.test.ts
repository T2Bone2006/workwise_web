import { describe, expect, it } from 'vitest';
import { workerLitePence } from '@/lib/billing/worker-price';
import { GATE_MESSAGE, decideGate, hasLiveLite, hasProTier, isLinkLive } from '@/lib/billing/worker-gate';

describe('workerLitePence', () => {
  it('is 20% off the Lite price: £28 a month, £280 a year', () => {
    expect(workerLitePence('month')).toBe(2800);
    expect(workerLitePence('year')).toBe(28000);
  });
});

describe('hasProTier / hasLiveLite', () => {
  it('counts only entitled Pro-tier rows (manual status counts, cancelled does not)', () => {
    expect(hasProTier([{ product: 'pro', status: 'manual' }])).toBe(true);
    expect(hasProTier([{ product: 'growth', status: 'active' }])).toBe(true);
    expect(hasProTier([{ product: 'pro', status: 'canceled' }])).toBe(false);
    expect(hasProTier([{ product: 'rounds', status: 'active' }])).toBe(false);
    expect(hasProTier([])).toBe(false);
  });
  it('sees a live Lite row only', () => {
    expect(hasLiveLite([{ product: 'lite', status: 'active' }])).toBe(true);
    expect(hasLiveLite([{ product: 'lite', status: 'past_due' }])).toBe(true);
    expect(hasLiveLite([{ product: 'lite', status: 'canceled' }])).toBe(false);
    expect(hasLiveLite([{ product: 'rounds', status: 'active' }])).toBe(false);
  });
});

describe('isLinkLive', () => {
  const live = { workerFound: true, inviteStatus: 'accepted', workerType: 'company_subcontractor', employerHasProTier: true };
  it('is live when the worker is active and the employer has a Pro plan', () => {
    expect(isLinkLive(live)).toBe(true);
    expect(isLinkLive({ ...live, inviteStatus: null })).toBe(true);
  });
  it('ends when the worker is gone, deactivated, or the employer has no Pro plan', () => {
    expect(isLinkLive({ ...live, workerFound: false })).toBe(false);
    expect(isLinkLive({ ...live, inviteStatus: 'deactivated' })).toBe(false);
    expect(isLinkLive({ ...live, employerHasProTier: false })).toBe(false);
    expect(isLinkLive({ ...live, workerType: 'platform_solo' })).toBe(false);
  });
  it('is unknown when the employer could not be read, even if the worker is gone', () => {
    expect(isLinkLive({ ...live, employerHasProTier: null })).toBe('unknown');
    expect(isLinkLive({ ...live, workerFound: false, employerHasProTier: null })).toBe('unknown');
  });
});

describe('decideGate', () => {
  const ok = { closedAt: null, linkedWorkerId: 'w1', link: true as const, alreadyHasLite: false };
  it('lets a linked worker business without Lite through', () => {
    expect(decideGate(ok)).toEqual({ ok: true });
  });
  it('refuses a closed business first', () => {
    expect(decideGate({ ...ok, closedAt: '2026-10-01' })).toEqual({ ok: false, reason: 'closed' });
  });
  it('refuses a business that was not made from a worker invite', () => {
    expect(decideGate({ ...ok, linkedWorkerId: null })).toEqual({ ok: false, reason: 'not_worker_business' });
  });
  it('refuses when the link ended, and when it could not be read (fail closed)', () => {
    expect(decideGate({ ...ok, link: false })).toEqual({ ok: false, reason: 'link_ended' });
    expect(decideGate({ ...ok, link: 'unknown' })).toEqual({ ok: false, reason: 'unknown' });
  });
  it('refuses when Lite is already on', () => {
    expect(decideGate({ ...ok, alreadyHasLite: true })).toEqual({ ok: false, reason: 'has_lite' });
  });
  it('has a message for every reason', () => {
    for (const reason of ['not_worker_business', 'link_ended', 'has_lite', 'closed', 'unknown'] as const) {
      expect(GATE_MESSAGE[reason].length).toBeGreaterThan(10);
    }
  });
});
