import { describe, expect, it } from 'vitest';
import {
  assertCancellationInstant,
  cancellationIsoFromParts,
  canCancelJob,
  defaultCancellationParts,
} from '@/lib/jobs/cancellation-time';

describe('cancellation time', () => {
  const now = new Date(2026, 9, 14, 15, 30, 0);

  it('defaults the form to the current local date and time', () => {
    expect(defaultCancellationParts(now)).toEqual({ date: '2026-10-14', time: '15:30' });
  });

  it('turns a local date and time into that same instant', () => {
    expect(cancellationIsoFromParts('2026-10-14', '15:30')).toBe(now.toISOString());
  });

  it('rejects a date that is not a real day', () => {
    expect(cancellationIsoFromParts('2026-02-31', '10:00')).toBeNull();
    expect(cancellationIsoFromParts('14/10/2026', '10:00')).toBeNull();
  });

  it('allows a time up to a few minutes ahead and rejects later ones', () => {
    const iso = cancellationIsoFromParts('2026-10-14', '15:30');
    expect(iso).toBeTruthy();
    expect(assertCancellationInstant(iso!, now.getTime()).ok).toBe(true);
    expect(
      assertCancellationInstant(new Date(now.getTime() + 2 * 60 * 1000).toISOString(), now.getTime()).ok
    ).toBe(true);
    const future = assertCancellationInstant(
      new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      now.getTime()
    );
    expect(future).toEqual({ ok: false, error: "Cancellation time can't be in the future." });
  });

  it('lets open jobs be cancelled and leaves finished ones alone', () => {
    expect(canCancelJob('pending')).toBe(true);
    expect(canCancelJob('paused')).toBe(true);
    expect(canCancelJob('incomplete')).toBe(true);
    expect(canCancelJob('completed')).toBe(false);
    expect(canCancelJob('cancelled')).toBe(false);
    expect(canCancelJob(null)).toBe(false);
  });
});
