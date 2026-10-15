import { describe, expect, it } from 'vitest';
import { buildComingUp, mondayOf, sliceComingUp, type ComingUpAgreement } from '@/lib/rounds/coming-up';
import { forecastVisitsUntil, forecastVisits, type AgreementSchedule } from '@/lib/rounds/recurrence';
import { parseRoundsSettings } from '@/lib/rounds/settings';

// Wednesday 7 Oct 2026. Weeks start Mon 5 Oct, 12 Oct, 19 Oct, 26 Oct, 2 Nov …
const TODAY = '2026-10-07';
const SETTINGS = parseRoundsSettings({ horizon_weeks: 8, working_days: [1, 2, 3, 4, 5] });

function agreement(over: Partial<ComingUpAgreement> = {}): ComingUpAgreement {
  return {
    id: 'a1', price: 15, frequency_days: 28, next_due_date: '2026-10-13', preferred_weekday: null,
    preferred_time: null, schedule_mode: 'fixed', status: 'active', paused_until: null, ...over,
  };
}
const sched = (a: Partial<AgreementSchedule> = {}): AgreementSchedule => agreement(a);

describe('forecastVisitsUntil', () => {
  it('lists every occurrence on its rhythm with no cap, from the cursor', () => {
    const v = forecastVisitsUntil(sched({ frequency_days: 7, next_due_date: '2026-10-13' }), SETTINGS, TODAY, '2026-11-08');
    expect(v.map((x) => x.scheduledDate)).toEqual(['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03']);
  });

  it('is longer than forecastVisits, whose two-visit cap is unchanged', () => {
    const a = sched({ frequency_days: 7, next_due_date: '2026-10-13' });
    expect(forecastVisits(a, SETTINGS, TODAY)).toHaveLength(2);
    expect(forecastVisitsUntil(a, SETTINGS, TODAY, '2026-12-31').length).toBeGreaterThan(10);
  });

  it('skips an occurrence that is already booked', () => {
    const v = forecastVisitsUntil(sched({ frequency_days: 7, next_due_date: '2026-10-13' }), SETTINGS, TODAY, '2026-11-01', new Set(['2026-10-20']));
    expect(v.map((x) => x.occurrenceDate)).toEqual(['2026-10-13', '2026-10-27']);
  });

  it('snaps to the preferred weekday', () => {
    // 13 Oct is a Tuesday; preferred Thursday (4) → 15 Oct
    const v = forecastVisitsUntil(sched({ next_due_date: '2026-10-13', preferred_weekday: 4 }), SETTINGS, TODAY, '2026-10-31');
    expect(v[0]).toEqual({ occurrenceDate: '2026-10-13', scheduledDate: '2026-10-15' });
  });

  it('catches an overdue cursor up to the next occurrence on or after today', () => {
    const v = forecastVisitsUntil(sched({ frequency_days: 7, next_due_date: '2026-09-22' }), SETTINGS, TODAY, '2026-10-20');
    expect(v.map((x) => x.occurrenceDate)).toEqual(['2026-10-13', '2026-10-20']);
  });

  it('adds nothing for an ended agreement, or a paused one with no end date', () => {
    expect(forecastVisitsUntil(sched({ status: 'ended' }), SETTINGS, TODAY, '2026-12-31')).toEqual([]);
    expect(forecastVisitsUntil(sched({ status: 'paused', paused_until: null }), SETTINGS, TODAY, '2026-12-31')).toEqual([]);
  });

  it('starts a paused agreement from its end date', () => {
    const v = forecastVisitsUntil(sched({ status: 'paused', paused_until: '2026-11-02', frequency_days: 7, next_due_date: '2026-10-13' }), SETTINGS, TODAY, '2026-11-15');
    expect(v.map((x) => x.scheduledDate)).toEqual(['2026-11-03', '2026-11-10']);
  });

  it('adds nothing when the pause runs past the window', () => {
    expect(forecastVisitsUntil(sched({ status: 'paused', paused_until: '2027-01-01' }), SETTINGS, TODAY, '2026-12-31')).toEqual([]);
  });

  it('after-completion: estimates one a frequency apart from the due date', () => {
    const v = forecastVisitsUntil(sched({ schedule_mode: 'after_completion', frequency_days: 28, next_due_date: '2026-10-13' }), SETTINGS, TODAY, '2026-12-31');
    expect(v.map((x) => x.scheduledDate)).toEqual(['2026-10-13', '2026-11-10', '2026-12-08']);
  });

  it('after-completion: with a visit booked, carries on from that occurrence', () => {
    const v = forecastVisitsUntil(sched({ schedule_mode: 'after_completion', frequency_days: 28, next_due_date: '2026-10-13' }), SETTINGS, TODAY, '2026-12-31', new Set(['2026-10-13']));
    expect(v.map((x) => x.occurrenceDate)).toEqual(['2026-11-10', '2026-12-08']);
  });

  it('after-completion: an overdue one is estimated for today, not stacked', () => {
    const v = forecastVisitsUntil(sched({ schedule_mode: 'after_completion', frequency_days: 28, next_due_date: '2026-08-01' }), SETTINGS, TODAY, '2026-12-31');
    expect(v[0].scheduledDate).toBe('2026-10-07');
    expect(v.map((x) => x.scheduledDate)).toEqual(['2026-10-07', '2026-11-04', '2026-12-02', '2026-12-30']); // a frequency apart, not stacked on today
  });
});

describe('buildComingUp', () => {
  const build = (over: Partial<Parameters<typeof buildComingUp>[0]> = {}) =>
    buildComingUp({ today: TODAY, weeks: 4, settings: SETTINGS, booked: [], agreements: [], ...over });

  it('runs Monday to Sunday from this week, labelled "w/c …"', () => {
    const c = build();
    expect(c.weeks).toHaveLength(4);
    expect(c.weeks[0]).toMatchObject({ weekStart: '2026-10-05', weekEnd: '2026-10-11', label: 'w/c 5 Oct' });
    expect(c.weeks[3]).toMatchObject({ weekStart: '2026-10-26', weekEnd: '2026-11-01', label: 'w/c 26 Oct' });
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
  });

  it('with nothing at all, every week has no stops and every working day from today is spare', () => {
    const c = build();
    expect(c.totalStops).toBe(0);
    expect(c.totalAmount).toBe(0);
    // This week: today Wed + Thu + Fri; the next three weeks: five each.
    expect(c.weeks[0].spareDays).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
    expect(c.weeks[1].spareDays).toHaveLength(5);
    expect(c.totalSpareDays).toBe(3 + 15);
  });

  it('counts booked visits and their money, with a visit with no price using its agreement', () => {
    const c = build({
      agreements: [agreement({ id: 'a1', price: 15, next_due_date: '2027-06-01' })],
      booked: [
        { scheduledDate: '2026-10-08', amount: 20, agreementId: 'a1', occurrenceDate: '2026-10-08' },
        { scheduledDate: '2026-10-08', amount: null, agreementId: 'a1', occurrenceDate: '2026-10-08' },
        { scheduledDate: '2026-10-09', amount: null, agreementId: null, occurrenceDate: null }, // one-off, no price
      ],
    });
    expect(c.weeks[0]).toMatchObject({ stops: 3, amount: 35, forecastStops: 0 });
    expect(c.weeks[0].spareDays).toEqual(['2026-10-07']);
  });

  it('adds forecast stops from agreements and marks them as forecast', () => {
    const c = build({ agreements: [agreement({ frequency_days: 7, next_due_date: '2026-10-13', price: 10 })] });
    expect(c.weeks[0].stops).toBe(0);
    expect(c.weeks[1]).toMatchObject({ stops: 1, amount: 10, forecastStops: 1 });
    expect(c.weeks.map((w) => w.stops)).toEqual([0, 1, 1, 1]);
  });

  it('never counts the same agreement visit twice', () => {
    const c = build({
      agreements: [agreement({ id: 'a1', frequency_days: 7, next_due_date: '2026-10-13' })],
      booked: [{ scheduledDate: '2026-10-13', amount: 15, agreementId: 'a1', occurrenceDate: '2026-10-13' }],
    });
    expect(c.weeks[1]).toMatchObject({ stops: 1, forecastStops: 0 });
  });

  it('works past the calendar: a 12-week view keeps forecasting', () => {
    const c = build({ weeks: 12, agreements: [agreement({ frequency_days: 14, next_due_date: '2026-10-13' })] });
    expect(c.weeks).toHaveLength(12);
    expect(c.weeks[11].weekStart).toBe('2026-12-21');
    expect(c.totalStops).toBe(6);
  });

  it('spare days: only working days, from today, never a blackout, only with no stops', () => {
    const c = build({
      settings: parseRoundsSettings({ working_days: [1, 2, 3, 4, 5], blackouts: ['2026-10-14'] }),
      booked: [{ scheduledDate: '2026-10-13', amount: 10, agreementId: null, occurrenceDate: null }],
    });
    expect(c.weeks[0].spareDays).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']); // not Mon/Tue (past) or the weekend
    expect(c.weeks[1].spareDays).toEqual(['2026-10-12', '2026-10-15', '2026-10-16']); // Tue booked, Wed blackout
  });

  it('says how many working days a week has left, so a full week can be told from a finished one', () => {
    const c = build({
      settings: parseRoundsSettings({ working_days: [1, 2, 3, 4, 5], blackouts: ['2026-10-14'] }),
      booked: [{ scheduledDate: '2026-10-13', amount: 10, agreementId: null, occurrenceDate: null }],
    });
    expect(c.weeks[0].workingDays).toBe(3); // Wed, Thu, Fri
    expect(c.weeks[1].workingDays).toBe(4); // Mon–Fri minus the day off
    // On a Saturday there is nothing left to plan this week.
    const sat = buildComingUp({ today: '2026-10-10', weeks: 4, settings: SETTINGS, booked: [], agreements: [] });
    expect(sat.weeks[0].workingDays).toBe(0);
    expect(sat.weeks[0].spareDays).toEqual([]);
  });

  it('a Saturday only counts as spare for someone who works Saturdays', () => {
    const six = build({ settings: parseRoundsSettings({ working_days: [1, 2, 3, 4, 5, 6] }) });
    expect(six.weeks[1].spareDays).toContain('2026-10-17');
    expect(build().weeks[1].spareDays).not.toContain('2026-10-17');
  });

  it('ignores booked visits outside the window', () => {
    const c = build({
      booked: [
        { scheduledDate: '2026-10-02', amount: 99, agreementId: null, occurrenceDate: null },
        { scheduledDate: '2026-12-01', amount: 99, agreementId: null, occurrenceDate: null },
      ],
    });
    expect(c.totalStops).toBe(0);
  });

  it('adds money in pence, so £0.10 + £0.20 is £0.30', () => {
    const c = build({
      booked: [
        { scheduledDate: '2026-10-08', amount: 0.1, agreementId: null, occurrenceDate: null },
        { scheduledDate: '2026-10-09', amount: 0.2, agreementId: null, occurrenceDate: null },
      ],
    });
    expect(c.weeks[0].amount).toBe(0.3);
    expect(c.totalAmount).toBe(0.3);
  });

  it('counts houses per day, and a day already worked is not free', () => {
    const c = build({
      booked: [
        // Thu 8 Oct: one customer with two visits = one stop on the day
        { scheduledDate: '2026-10-08', amount: 10, agreementId: null, occurrenceDate: null, customerId: 'c1' },
        { scheduledDate: '2026-10-08', amount: 15, agreementId: null, occurrenceDate: null, customerId: 'c1' },
        // Fri 9 Oct: done early — worked, so not free, but not work still to come
        { scheduledDate: '2026-10-09', amount: 20, agreementId: null, occurrenceDate: null, customerId: 'c2', done: true },
      ],
    });
    const day = (date: string) => c.weeks[0].days.find((d) => d.date === date);
    expect(day('2026-10-08')).toEqual({ date: '2026-10-08', stops: 1, plannable: true });
    expect(day('2026-10-09')).toEqual({ date: '2026-10-09', stops: 1, plannable: true });
    expect(c.weeks[0].spareDays).toEqual(['2026-10-07']);
    expect(c.weeks[0]).toMatchObject({ stops: 2, amount: 25 }); // the done visit adds no stop or money to come
    expect(day('2026-10-05')).toMatchObject({ plannable: false }); // Monday has gone
    expect(c.weeks[0].days).toHaveLength(7);
  });

  it('totals add up', () => {
    const c = build({ weeks: 8, agreements: [agreement({ frequency_days: 7, next_due_date: '2026-10-13', price: 12.5 })] });
    expect(c.totalStops).toBe(c.weeks.reduce((s, w) => s + w.stops, 0));
    expect(c.totalAmount).toBe(c.weeks.reduce((s, w) => s + w.amount, 0));
    expect(c.totalSpareDays).toBe(c.weeks.reduce((s, w) => s + w.spareDays.length, 0));
  });
});

describe('sliceComingUp', () => {
  it('gives the first 4 or 8 weeks of a 12-week view with matching totals', () => {
    const full = buildComingUp({
      today: TODAY, weeks: 12, settings: SETTINGS, booked: [],
      agreements: [agreement({ frequency_days: 7, next_due_date: '2026-10-13', price: 10 })],
    });
    const four = sliceComingUp(full, 4);
    expect(four.weeks).toHaveLength(4);
    expect(four).toEqual(buildComingUp({ today: TODAY, weeks: 4, settings: SETTINGS, booked: [], agreements: [agreement({ frequency_days: 7, next_due_date: '2026-10-13', price: 10 })] }));
    expect(sliceComingUp(full, 8).totalStops).toBe(7);
  });
});
