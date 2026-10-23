import { describe, expect, it } from 'vitest';
import { DECLINE_REASON_MAX, canRespond, cleanDeclineReason, isJobId } from '@/lib/worker/respond';

describe('isJobId', () => {
  it('accepts a uuid and nothing else', () => {
    expect(isJobId('3f60dfac-7f2c-499b-bbbf-4b0f97a7cd08')).toBe(true);
    expect(isJobId('3F60DFAC-7F2C-499B-BBBF-4B0F97A7CD08')).toBe(true);
    expect(isJobId('not-an-id')).toBe(false);
    expect(isJobId('3f60dfac-7f2c-499b-bbbf-4b0f97a7cd08; drop table jobs')).toBe(false);
    expect(isJobId(undefined)).toBe(false);
    expect(isJobId(42)).toBe(false);
  });
});

describe('cleanDeclineReason', () => {
  it('treats blank and non-text as no reason', () => {
    expect(cleanDeclineReason('')).toBeNull();
    expect(cleanDeclineReason('   \n ')).toBeNull();
    expect(cleanDeclineReason(null)).toBeNull();
    expect(cleanDeclineReason(12)).toBeNull();
  });

  it('trims and tidies whitespace', () => {
    expect(cleanDeclineReason('  Away   that\nday ')).toBe('Away that day');
  });

  it('cuts a long reason to the limit', () => {
    const out = cleanDeclineReason('a'.repeat(DECLINE_REASON_MAX + 200));
    expect(out).toHaveLength(DECLINE_REASON_MAX);
  });
});

describe('canRespond', () => {
  it('is only true for a job sent to the worker and not yet answered', () => {
    expect(canRespond({ status: 'assigned' })).toBe(true);
    for (const status of ['accepted', 'declined', 'en_route', 'in_progress', 'completed', 'incomplete', 'pending']) {
      expect(canRespond({ status })).toBe(false);
    }
  });

  it('is false for a Rounds visit, which needs no accepting', () => {
    expect(canRespond({ status: 'assigned', rounds: true })).toBe(false);
  });
});
