import { describe, expect, it } from 'vitest';
import { isAllowedTarget, planPushBack, type PushBackVisit } from '@/lib/rounds/push-back';

// Monday 12 October 2026.
const MON = '2026-10-12';
const day = (offset: number) => {
  const d = new Date(`${MON}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const visit = (id: string, offset: number, over: Partial<PushBackVisit> = {}): PushBackVisit => ({
  id,
  date: day(offset),
  position: null,
  agreementId: null,
  nextVisitDate: null,
  ...over,
});
const base = { workingDays: [1, 2, 3, 4], blackouts: [], lastDay: day(120) };

// Dave works Mon–Thu for three weeks; Friday is empty.
const threeWeeks = (): PushBackVisit[] => {
  const out: PushBackVisit[] = [];
  for (const week of [0, 7, 14]) for (const d of [0, 1, 2, 3]) out.push(visit(`w${week}d${d}`, week + d));
  return out;
};

describe('planPushBack: the owner’s example', () => {
  it('slides Mon–Thu work along when Dave is off Monday and Tuesday, and catches up on a spare day', () => {
    const plan = planPushBack({ ...base, visits: threeWeeks(), offDays: [day(0), day(1)] });
    const target = Object.fromEntries(plan.moves.map((m) => [m.id, m.to]));
    expect(target).toEqual({
      w0d0: day(2), // Mon  → Wed
      w0d1: day(3), // Tue  → Thu
      w0d2: day(4), // Wed  → Fri (the spare day)
      w0d3: day(7), // Thu  → next Mon (the weekend is skipped)
      w7d0: day(8), // next Mon → Tue
      w7d1: day(9), // → Wed
      w7d2: day(10), // → Thu
      w7d3: day(11), // → Fri (spare)
      // week 3 stays: the work has caught up
    });
    expect(plan.moves.find((m) => m.id.startsWith('w14'))).toBeUndefined();
    expect(plan.stuck).toEqual([]);
  });

  it('keeps the order of the round within a day', () => {
    const visits = [
      visit('b', 0, { position: 2 }),
      visit('a', 0, { position: 1 }),
      visit('c', 0, { position: null }),
    ];
    const plan = planPushBack({ ...base, visits, offDays: [day(0)] });
    expect(plan.moves.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(new Set(plan.moves.map((m) => m.to))).toEqual(new Set([day(1)]));
  });

  it('does nothing when nothing falls on a day off', () => {
    const plan = planPushBack({ ...base, visits: [visit('x', 2), visit('y', 3)], offDays: [day(0), day(1)] });
    expect(plan).toEqual({ moves: [], stuck: [] });
  });
});

describe('planPushBack: edges', () => {
  it('never targets an off day, a blackout day, or a weekend the person does not work', () => {
    const plan = planPushBack({
      ...base,
      visits: [visit('a', 0)],
      offDays: [day(0), day(1)],
      blackouts: [day(2)], // Wednesday is a bank holiday
    });
    expect(plan.moves).toEqual([{ id: 'a', from: day(0), to: day(3) }]); // Thursday
  });

  it('uses Saturday for someone who works Saturdays', () => {
    const plan = planPushBack({
      ...base,
      workingDays: [1, 2, 3, 4, 5, 6],
      visits: [visit('fri', 4), visit('thu', 3)],
      offDays: [day(3), day(4)],
    });
    expect(plan.moves.find((m) => m.id === 'thu')?.to).toBe(day(5)); // Saturday
    expect(plan.moves.find((m) => m.id === 'fri')?.to).toBe(day(7)); // next Monday
  });

  it('honours a second holiday later on', () => {
    const plan = planPushBack({
      ...base,
      visits: [visit('a', 0)],
      offDays: [day(0), day(1), day(2), day(3), day(4)], // a whole week, then the weekend
    });
    expect(plan.moves).toEqual([{ id: 'a', from: day(0), to: day(7) }]);
  });

  it('leaves a visit where it is if its target would be on or after that customer’s next visit', () => {
    const plan = planPushBack({
      ...base,
      visits: [visit('weekly', 0, { nextVisitDate: day(2) }), visit('fortnightly', 0, { nextVisitDate: day(14) })],
      offDays: [day(0), day(1)],
    });
    expect(plan.stuck).toEqual([{ id: 'weekly', from: day(0), reason: 'next_visit' }]);
    expect(plan.moves).toEqual([{ id: 'fortnightly', from: day(0), to: day(2) }]);
  });

  it('reports visits it cannot place before the end of the planned weeks', () => {
    const plan = planPushBack({ ...base, lastDay: day(1), visits: [visit('a', 0)], offDays: [day(0), day(1)] });
    expect(plan.moves).toEqual([]);
    expect(plan.stuck).toEqual([{ id: 'a', from: day(0), reason: 'horizon' }]);
  });

  it('a visit sitting on a day off with a weekend start still slides forward', () => {
    const plan = planPushBack({ ...base, visits: [visit('sat', 5)], offDays: [day(5)] });
    expect(plan.moves).toEqual([{ id: 'sat', from: day(5), to: day(7) }]);
  });

  it('handles no visits', () => {
    expect(planPushBack({ ...base, visits: [], offDays: [day(0)] })).toEqual({ moves: [], stuck: [] });
  });
});

describe('isAllowedTarget', () => {
  const args = { offDays: [day(1)], workingDays: [1, 2, 3, 4], blackouts: [day(2)] };
  it('weekdays only unless the person works the weekend, never off or blackout days', () => {
    expect(isAllowedTarget(day(0), args)).toBe(true);
    expect(isAllowedTarget(day(1), args)).toBe(false);
    expect(isAllowedTarget(day(2), args)).toBe(false);
    expect(isAllowedTarget(day(4), args)).toBe(true);
    expect(isAllowedTarget(day(5), args)).toBe(false);
    expect(isAllowedTarget(day(5), { ...args, workingDays: [1, 2, 3, 4, 6] })).toBe(true);
  });
});
