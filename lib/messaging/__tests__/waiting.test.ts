import { describe, expect, it } from 'vitest';
import {
  GRACE_TEXTS_PER_MONTH,
  isMoneyKind,
  MONEY_KINDS,
  waitingExpiry,
} from '@/lib/messaging/waiting';

describe('waiting', () => {
  it('grace is 30 a month', () => {
    expect(GRACE_TEXTS_PER_MONTH).toBe(30);
  });

  it('money kinds are exactly the pay-link style messages', () => {
    expect([...MONEY_KINDS].sort()).toEqual(['chaser', 'dd_failed', 'dd_invite', 'visit_done']);
    for (const kind of ['reminder', 'visit_change', 'reply_ack', 'payment_received', 'refund'] as const) {
      expect(isMoneyKind(kind)).toBe(false);
    }
  });

  it('money messages wait 14 days, everything else 24 hours', () => {
    const from = new Date('2026-11-18T10:00:00.000Z');
    expect(waitingExpiry('visit_done', from).toISOString()).toBe('2026-12-02T10:00:00.000Z');
    expect(waitingExpiry('reminder', from).toISOString()).toBe('2026-11-19T10:00:00.000Z');
  });
});
