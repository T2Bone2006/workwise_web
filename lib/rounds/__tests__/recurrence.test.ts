import { describe, expect, it } from 'vitest';
import { addDays, isoWeekday } from '@/lib/rounds/dates';
import { DEFAULT_ROUNDS_SETTINGS, parseRoundsSettings } from '@/lib/rounds/settings';
import {
  buildVisitInsert,
  firstOccurrenceOnOrAfter,
  horizonEnd,
  nextDueAfter,
  occurrencesFrom,
  oneOffReferenceNumber,
  planNextAfterCompletion,
  forecastVisits,
  planVisits,
  shiftForWorkingDaysAndBlackouts,
  snapToPreferredWeekday,
  visitReferenceNumber,
  type AgreementSchedule,
} from '@/lib/rounds/recurrence';

const TODAY = '2026-09-15'; // Tuesday
const SETTINGS = parseRoundsSettings({
  horizon_weeks: 8,
  working_days: [1, 2, 3, 4, 5],
});
const SHIFT_ON = parseRoundsSettings({
  horizon_weeks: 8,
  working_days: [1, 2, 3, 4, 5],
  shift_off_non_working_days: true,
});

function agreement(over: Partial<AgreementSchedule> = {}): AgreementSchedule {
  return {
    id: 'a1b2c3de-0000-4000-8000-000000000001',
    frequency_days: 28,
    next_due_date: TODAY,
    preferred_weekday: null,
    preferred_time: '09:00',
    schedule_mode: 'fixed',
    status: 'active',
    paused_until: null,
    ...over,
  };
}

describe('horizon and occurrences', () => {
  it('horizon is today plus horizon_weeks in days', () => {
    expect(horizonEnd(TODAY, SETTINGS)).toBe('2026-11-10');
  });

  it('7/14/28-day fixed cycles fill an 8-week horizon', () => {
    const until = horizonEnd(TODAY, SETTINGS);
    expect(occurrencesFrom(TODAY, 7, until)).toHaveLength(9);
    expect(occurrencesFrom(TODAY, 14, until)).toHaveLength(5);
    expect(occurrencesFrom(TODAY, 28, until)).toHaveLength(3);

    expect(planVisits(agreement({ frequency_days: 7 }), SETTINGS, TODAY).visits).toHaveLength(9);
    expect(planVisits(agreement({ frequency_days: 14 }), SETTINGS, TODAY).visits).toHaveLength(5);
    expect(planVisits(agreement({ frequency_days: 28 }), SETTINGS, TODAY).visits).toHaveLength(3);
  });
});

describe('snapToPreferredWeekday', () => {
  it('leaves the date alone when preferred weekday is null', () => {
    expect(snapToPreferredWeekday(TODAY, null)).toBe(TODAY);
  });

  it('picks the nearest weekday within ±3 days', () => {
    // Tuesday 15th → Friday is +3.
    expect(snapToPreferredWeekday(TODAY, 5)).toBe('2026-09-18');
    expect(isoWeekday(snapToPreferredWeekday(TODAY, 5))).toBe(5);
    // Tuesday → Monday is -1 (nearer than +6).
    expect(snapToPreferredWeekday(TODAY, 1)).toBe('2026-09-14');
  });

  it('on a 3-vs-4 split picks the later date when that is nearer, else the nearer earlier date', () => {
    const wednesday = '2026-09-16';
    // Saturday is +3 (later) vs -4.
    expect(snapToPreferredWeekday(wednesday, 6)).toBe('2026-09-19');
    // Sunday is -3 (earlier) vs +4.
    expect(snapToPreferredWeekday(wednesday, 7)).toBe('2026-09-13');
  });
});

describe('shiftForWorkingDaysAndBlackouts', () => {
  it('leaves weekends and blackouts alone by default (spare days)', () => {
    expect(shiftForWorkingDaysAndBlackouts('2026-09-19', SETTINGS)).toBe('2026-09-19');
    expect(shiftForWorkingDaysAndBlackouts('2026-09-20', SETTINGS)).toBe('2026-09-20');
    expect(
      shiftForWorkingDaysAndBlackouts(
        '2026-12-25',
        parseRoundsSettings({ working_days: [1, 2, 3, 4, 5], blackouts: ['2026-12-25'] })
      )
    ).toBe('2026-12-25');
  });

  it('when opted in, skips weekends onto the next working day', () => {
    expect(shiftForWorkingDaysAndBlackouts('2026-09-19', SHIFT_ON)).toBe('2026-09-21'); // Sat → Mon
    expect(shiftForWorkingDaysAndBlackouts('2026-09-20', SHIFT_ON)).toBe('2026-09-21'); // Sun → Mon
  });

  it('when opted in, skips blackouts onto the next working day', () => {
    const withXmas = parseRoundsSettings({
      working_days: [1, 2, 3, 4, 5],
      blackouts: ['2026-12-25'],
      shift_off_non_working_days: true,
    });
    expect(shiftForWorkingDaysAndBlackouts('2026-12-25', withXmas)).toBe('2026-12-28');
  });

  it('when opted in, gives up after 14 tries and returns the input', () => {
    const boxedIn = parseRoundsSettings({
      working_days: [1],
      blackouts: ['2026-09-21', '2026-09-28'],
      shift_off_non_working_days: true,
    });
    // Sat 19th: 14 tries cover 19 Sep–2 Oct; both Mondays in that window are blacked out.
    expect(shiftForWorkingDaysAndBlackouts('2026-09-19', boxedIn)).toBe('2026-09-19');
  });
});

describe('planVisits (fixed)', () => {
  it('drops past occurrences from visits but still advances lastOccurrence', () => {
    const nextDue = addDays(TODAY, -28);
    const planned = planVisits(agreement({ frequency_days: 28, next_due_date: nextDue }), SETTINGS, TODAY);
    expect(planned.visits.every((v) => v.occurrenceDate >= TODAY)).toBe(true);
    expect(planned.visits).toHaveLength(3);
    expect(planned.lastOccurrence).toBe(addDays(nextDue, 28 * 3));
    expect(planned.visits.map((v) => v.occurrenceDate)).not.toContain(nextDue);
  });

  it('snaps a 28-day round onto Fridays', () => {
    const planned = planVisits(
      agreement({ frequency_days: 28, preferred_weekday: 5 }),
      SETTINGS,
      TODAY
    );
    expect(planned.visits.map((v) => v.scheduledDate)).toEqual([
      '2026-09-18',
      '2026-10-16',
      '2026-11-13',
    ]);
    expect(planned.visits.every((v) => isoWeekday(v.scheduledDate) === 5)).toBe(true);
  });

  it('returns nothing when paused or ended', () => {
    expect(planVisits(agreement({ status: 'paused' }), SETTINGS, TODAY)).toEqual({
      visits: [],
      lastOccurrence: null,
    });
    expect(planVisits(agreement({ status: 'ended' }), SETTINGS, TODAY)).toEqual({
      visits: [],
      lastOccurrence: null,
    });
  });
});

describe('forecastVisits', () => {
  it('shows the next two dates when the next clean is outside the 8-week job window', () => {
    const planned = forecastVisits(
      agreement({ frequency_days: 91, next_due_date: '2026-12-15', preferred_weekday: 2 }),
      SETTINGS,
      TODAY,
    );
    expect(planned).toEqual([
      { occurrenceDate: '2026-12-15', scheduledDate: '2026-12-15' },
      { occurrenceDate: '2027-03-16', scheduledDate: '2027-03-16' },
    ]);
  });

  it('starts from the cursor, so dates already written as jobs are not repeated', () => {
    const planned = forecastVisits(
      agreement({ frequency_days: 7, next_due_date: '2026-11-17' }),
      SETTINGS,
      TODAY,
    );
    expect(planned.map((visit) => visit.scheduledDate)).toEqual([
      '2026-11-17',
      '2026-11-24',
    ]);
  });

  it('shows one date for after_completion, and none once a visit is already booked', () => {
    const open = forecastVisits(
      agreement({ schedule_mode: 'after_completion', frequency_days: 84, next_due_date: '2026-12-01' }),
      SETTINGS,
      TODAY,
    );
    expect(open).toHaveLength(1);
    expect(open[0]?.scheduledDate).toBe('2026-12-01');

    const booked = forecastVisits(
      agreement({ schedule_mode: 'after_completion', next_due_date: '2026-12-01' }),
      SETTINGS,
      TODAY,
      new Set(['2026-12-01']),
    );
    expect(booked).toEqual([]);
  });
});

describe('planVisits (after_completion)', () => {
  it('returns exactly one visit, not an 8-week horizon', () => {
    const planned = planVisits(
      agreement({ schedule_mode: 'after_completion', frequency_days: 7 }),
      SETTINGS,
      TODAY
    );
    expect(planned.visits).toHaveLength(1);
    expect(planned.visits[0]?.occurrenceDate).toBe(TODAY);
    expect(planned.lastOccurrence).toBe(TODAY);
  });

  it('bumps a past due date to today, without shoving it off a spare day', () => {
    const planned = planVisits(
      agreement({
        schedule_mode: 'after_completion',
        next_due_date: '2026-08-01',
      }),
      SETTINGS,
      TODAY
    );
    expect(planned.visits).toHaveLength(1);
    expect(planned.visits[0]?.occurrenceDate).toBe('2026-08-01');
    expect(planned.visits[0]?.scheduledDate).toBe(TODAY);
  });

  it('keeps a past-due catch-up on Sunday unless they opted into auto-shift', () => {
    const sunday = '2026-09-20';
    const leftover = planVisits(
      agreement({
        schedule_mode: 'after_completion',
        next_due_date: '2026-08-01',
      }),
      SETTINGS,
      sunday
    );
    expect(leftover.visits[0]?.scheduledDate).toBe(sunday);

    const shifted = planVisits(
      agreement({
        schedule_mode: 'after_completion',
        next_due_date: '2026-08-01',
      }),
      SHIFT_ON,
      sunday
    );
    expect(shifted.visits[0]?.scheduledDate).toBe('2026-09-21');
  });
});

describe('planNextAfterCompletion', () => {
  it('from a Thursday completion is ~N days later, not the original Monday cadence', () => {
    const thursday = '2026-09-17';
    const next = planNextAfterCompletion({
      completedOn: thursday,
      frequencyDays: 7,
      preferredWeekday: null,
      settings: SETTINGS,
      today: thursday,
    });
    expect(next.occurrenceDate).toBe('2026-09-24');
    expect(next.scheduledDate).toBe('2026-09-24');
    expect(isoWeekday(next.scheduledDate)).toBe(4);
    expect(next.scheduledDate).not.toBe('2026-09-21'); // the following Monday
  });

  it('still snaps a nearby preferred weekday around that new date', () => {
    const thursday = '2026-09-17';
    const next = planNextAfterCompletion({
      completedOn: thursday,
      frequencyDays: 7,
      preferredWeekday: 5,
      settings: SETTINGS,
      today: thursday,
    });
    expect(next.occurrenceDate).toBe('2026-09-24');
    expect(next.scheduledDate).toBe('2026-09-25'); // Friday after next Thursday
  });
});

describe('nextDueAfter / firstOccurrenceOnOrAfter', () => {
  it('advances the cursor by frequency_days', () => {
    expect(nextDueAfter('2026-09-15', 28)).toBe('2026-10-13');
  });

  it('walks the cycle forward until it is on or after the date', () => {
    expect(firstOccurrenceOnOrAfter('2026-09-15', 28, '2026-09-15')).toBe('2026-09-15');
    expect(firstOccurrenceOnOrAfter('2026-09-15', 28, '2026-09-16')).toBe('2026-10-13');
    expect(firstOccurrenceOnOrAfter('2026-09-15', 28, '2026-11-01')).toBe('2026-11-10');
    expect(firstOccurrenceOnOrAfter('2026-10-13', 28, '2026-09-01')).toBe('2026-10-13');
  });
});

describe('reference numbers and visit insert', () => {
  it('formats agreement and one-off references', () => {
    expect(visitReferenceNumber('a1b2c3de-0000-4000-8000-000000000001', '2026-09-18')).toBe(
      'R-A1B2C3-20260918'
    );
    expect(oneOffReferenceNumber('2026-09-18', 'Ab9F')).toBe('R1-20260918-ab9f');
  });

  it('builds a jobs row the existing table will accept (assigned, empty industry_data)', () => {
    const visit = { occurrenceDate: '2026-09-15', scheduledDate: '2026-09-18' };
    const row = buildVisitInsert({
      tenantId: '11111111-1111-1111-1111-111111111111',
      workerId: '22222222-2222-2222-2222-222222222222',
      visit,
      agreement: {
        id: 'a1b2c3de-0000-4000-8000-000000000001',
        customer_id: '33333333-3333-3333-3333-333333333333',
        title: 'Window clean',
        address: '12 Elm Road',
        postcode: 'SW1A 1AA',
        lat: 51.5,
        lng: -0.1,
        price: 15,
        duration_minutes: 30,
        preferred_time: '09:00:00',
        access_notes: 'Side gate',
        service_name: 'Window cleaning',
      },
    });

    expect(row.status).toBe('assigned');
    expect(row.priority).toBe('normal');
    expect(row.payment_status).toBe('unpaid');
    expect(row.customer_confirmation_status).toBeNull();
    expect(row.industry_data).toEqual({});
    expect(row.required_skills).toEqual([]);
    expect(row.job_description).toBe('Window clean');
    expect(row.quoted_amount).toBe(15);
    expect(row.scheduled_date).toBe('2026-09-18');
    expect(row.agreement_occurrence_date).toBe('2026-09-15');
    expect(row.reference_number).toBe('R-A1B2C3-20260915');
    expect(row.custom_fields.rounds).toEqual({
      agreement_id: 'a1b2c3de-0000-4000-8000-000000000001',
      service_name: 'Window cleaning',
      access_notes: 'Side gate',
    });
  });
});

describe('DEFAULT_ROUNDS_SETTINGS', () => {
  it('matches what signup already writes, with auto-shift off', () => {
    expect(DEFAULT_ROUNDS_SETTINGS.horizon_weeks).toBe(8);
    expect(DEFAULT_ROUNDS_SETTINGS.working_days).toEqual([1, 2, 3, 4, 5]);
    expect(DEFAULT_ROUNDS_SETTINGS.shift_off_non_working_days).toBe(false);
  });
});
