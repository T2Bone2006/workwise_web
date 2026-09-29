import { describe, expect, it } from 'vitest';
import {
  planChasers,
  type ChaserCandidate,
} from '@/lib/messaging/chasers';
import { DEFAULT_MESSAGING_SETTINGS } from '@/lib/messaging/settings';
import { addDays } from '@/lib/rounds/dates';

const settings = {
  chasers_enabled: DEFAULT_MESSAGING_SETTINGS.chasers_enabled,
  chase_first_days: DEFAULT_MESSAGING_SETTINGS.chase_first_days,
  chase_second_days: DEFAULT_MESSAGING_SETTINGS.chase_second_days,
};

const today = '2026-09-28';
const now = new Date('2026-09-28T18:00:00.000Z');

function candidate(
  overrides: Partial<ChaserCandidate> & Pick<ChaserCandidate, 'customerId'>,
): ChaserCandidate {
  return {
    owed: 40,
    oldestUnpaidDate: addDays(today, -7),
    paymentTerms: 'on_the_day',
    paymentChasers: true,
    isActive: true,
    preferredChannel: null,
    lastChaserAt: null,
    ...overrides,
  };
}

describe('planChasers', () => {
  it('stages by age of oldest unpaid: 6 nothing, 7 stage 1, 21 stage 2', () => {
    expect(
      planChasers(
        [candidate({ customerId: 'c6', oldestUnpaidDate: addDays(today, -6) })],
        settings,
        { today, invoiceDueDays: 14, now },
      ),
    ).toEqual([]);

    const stage1 = planChasers(
      [candidate({ customerId: 'c7', oldestUnpaidDate: addDays(today, -7) })],
      settings,
      { today, invoiceDueDays: 14, now },
    );
    expect(stage1).toHaveLength(1);
    expect(stage1[0]).toMatchObject({
      customerId: 'c7',
      stage: 1,
      baseDate: addDays(today, -7),
    });

    const stage2 = planChasers(
      [candidate({ customerId: 'c21', oldestUnpaidDate: addDays(today, -21) })],
      settings,
      { today, invoiceDueDays: 14, now },
    );
    expect(stage2).toHaveLength(1);
    expect(stage2[0]).toMatchObject({
      customerId: 'c21',
      stage: 2,
      baseDate: addDays(today, -21),
    });
  });

  it('invoice customers count from due date (oldest + invoiceDueDays)', () => {
    expect(
      planChasers(
        [
          candidate({
            customerId: 'inv20',
            paymentTerms: 'invoice',
            oldestUnpaidDate: addDays(today, -20),
          }),
        ],
        settings,
        { today, invoiceDueDays: 14, now },
      ),
    ).toEqual([]);

    const stage1 = planChasers(
      [
        candidate({
          customerId: 'inv21',
          paymentTerms: 'invoice',
          oldestUnpaidDate: addDays(today, -21),
        }),
      ],
      settings,
      { today, invoiceDueDays: 14, now },
    );
    expect(stage1).toHaveLength(1);
    expect(stage1[0]).toMatchObject({
      customerId: 'inv21',
      stage: 1,
      baseDate: addDays(today, -7),
    });
  });

  it('skips when paymentChasers false, inactive, none, or owed 0', () => {
    expect(
      planChasers(
        [
          candidate({ customerId: 'off', paymentChasers: false }),
          candidate({ customerId: 'inactive', isActive: false }),
          candidate({ customerId: 'none', preferredChannel: 'none' }),
          candidate({ customerId: 'zero', owed: 0 }),
        ],
        settings,
        { today, invoiceDueDays: 14, now },
      ),
    ).toEqual([]);
  });

  it('pauses chasing while their reply waits in Needs attention', () => {
    expect(
      planChasers(
        [candidate({ customerId: 'replied', awaitingReview: true })],
        settings,
        { today, invoiceDueDays: 14, now },
      ),
    ).toEqual([]);
    expect(
      planChasers(
        [candidate({ customerId: 'dealt-with', awaitingReview: false })],
        settings,
        { today, invoiceDueDays: 14, now },
      ),
    ).toHaveLength(1);
  });

  it('skips when lastChaserAt is within 7 days; allows after 8 days', () => {
    expect(
      planChasers(
        [
          candidate({
            customerId: 'recent',
            oldestUnpaidDate: addDays(today, -21),
            lastChaserAt: '2026-09-25T12:00:00.000Z',
          }),
        ],
        settings,
        { today, invoiceDueDays: 14, now },
      ),
    ).toEqual([]);

    const ok = planChasers(
      [
        candidate({
          customerId: 'old',
          oldestUnpaidDate: addDays(today, -21),
          lastChaserAt: '2026-09-20T12:00:00.000Z',
        }),
      ],
      settings,
      { today, invoiceDueDays: 14, now },
    );
    expect(ok).toHaveLength(1);
    expect(ok[0].customerId).toBe('old');
  });

  it('returns nothing when business chasers_enabled is false', () => {
    expect(
      planChasers(
        [candidate({ customerId: 'c' })],
        { ...settings, chasers_enabled: false },
        { today, invoiceDueDays: 14, now },
      ),
    ).toEqual([]);
  });

  it('builds stable dedupe keys that differ by stage', () => {
    const oldest = addDays(today, -21);
    const first = planChasers(
      [candidate({ customerId: 'cust-a', oldestUnpaidDate: oldest })],
      settings,
      { today, invoiceDueDays: 14, now },
    );
    const second = planChasers(
      [candidate({ customerId: 'cust-a', oldestUnpaidDate: oldest })],
      settings,
      { today, invoiceDueDays: 14, now },
    );

    expect(first[0].dedupeKey).toBe(`chaser:cust-a:${oldest}:2`);
    expect(second[0].dedupeKey).toBe(first[0].dedupeKey);

    const young = planChasers(
      [
        candidate({
          customerId: 'cust-a',
          oldestUnpaidDate: addDays(today, -7),
        }),
      ],
      settings,
      { today, invoiceDueDays: 14, now },
    );
    expect(young[0].dedupeKey).toBe(
      `chaser:cust-a:${addDays(today, -7)}:1`,
    );
    expect(young[0].dedupeKey).not.toBe(first[0].dedupeKey);
  });

  it('sorts biggest debts first', () => {
    const plans = planChasers(
      [
        candidate({ customerId: 'small', owed: 10 }),
        candidate({ customerId: 'big', owed: 100 }),
        candidate({ customerId: 'mid', owed: 40 }),
      ],
      settings,
      { today, invoiceDueDays: 14, now },
    );
    expect(plans.map((p) => p.customerId)).toEqual(['big', 'mid', 'small']);
  });
});
