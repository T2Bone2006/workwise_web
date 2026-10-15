import { describe, expect, it } from 'vitest';
import {
  moveStopSchema,
  swapDaysSchema,
  tellChangeSchema,
} from '@/lib/validations/rounds/visit';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

describe('moveStopSchema', () => {
  it('accepts a stop with and without an order', () => {
    expect(moveStopSchema.safeParse({ jobIds: [ID_A], toDate: '2026-10-08' }).success).toBe(true);
    expect(
      moveStopSchema.safeParse({ jobIds: [ID_A, ID_B], toDate: '2026-10-08', orderedJobIds: [ID_B, ID_A] })
        .success,
    ).toBe(true);
  });

  it('rejects no jobs, too many jobs, a bad id, a bad date and a missing date', () => {
    expect(moveStopSchema.safeParse({ jobIds: [], toDate: '2026-10-08' }).success).toBe(false);
    expect(
      moveStopSchema.safeParse({ jobIds: Array.from({ length: 21 }, () => ID_A), toDate: '2026-10-08' }).success,
    ).toBe(false);
    expect(moveStopSchema.safeParse({ jobIds: ['x'], toDate: '2026-10-08' }).success).toBe(false);
    expect(moveStopSchema.safeParse({ jobIds: [ID_A], toDate: '2026-02-30' }).success).toBe(false);
    expect(moveStopSchema.safeParse({ jobIds: [ID_A] }).success).toBe(false);
    expect(moveStopSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an order with a bad id or more than 300 entries', () => {
    expect(moveStopSchema.safeParse({ jobIds: [ID_A], toDate: '2026-10-08', orderedJobIds: ['x'] }).success).toBe(false);
    expect(
      moveStopSchema.safeParse({
        jobIds: [ID_A],
        toDate: '2026-10-08',
        orderedJobIds: Array.from({ length: 301 }, () => ID_A),
      }).success,
    ).toBe(false);
  });
});

describe('swapDaysSchema', () => {
  const ok = { dayA: '2026-10-06', dayB: '2026-10-08', clientKey: ID_A };

  it('accepts two days and a key, with or without notifyCustomers', () => {
    expect(swapDaysSchema.safeParse(ok).success).toBe(true);
    expect(swapDaysSchema.safeParse({ ...ok, notifyCustomers: true }).success).toBe(true);
  });

  it('rejects a missing or non-uuid clientKey, a bad date, or a non-boolean notify', () => {
    const { clientKey: _omit, ...noKey } = ok;
    void _omit;
    const result = swapDaysSchema.safeParse(noKey);
    expect(result.success).toBe(false);
    expect(swapDaysSchema.safeParse({ ...ok, clientKey: 'abc' }).success).toBe(false);
    expect(swapDaysSchema.safeParse({ ...ok, dayA: 'tuesday' }).success).toBe(false);
    expect(swapDaysSchema.safeParse({ ...ok, notifyCustomers: 'yes' }).success).toBe(false);
  });

  it('gives a readable message for a bad key', () => {
    const result = swapDaysSchema.safeParse({ ...ok, clientKey: 'abc' });
    expect(!result.success && result.error.issues[0]?.message).toBe('Invalid request');
  });
});

describe('tellChangeSchema', () => {
  it('accepts a uuid and rejects anything else', () => {
    expect(tellChangeSchema.safeParse({ changeId: ID_A }).success).toBe(true);
    expect(tellChangeSchema.safeParse({ changeId: 'nope' }).success).toBe(false);
    expect(tellChangeSchema.safeParse({}).success).toBe(false);
  });
});
