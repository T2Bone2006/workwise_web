import { describe, expect, it } from 'vitest';
import { summariseWeek } from '@/lib/rounds/week-glance';

// Week of Mon 28 Sep 2026; today is Thursday 1 Oct.
const base = { monday: '2026-09-28', today: '2026-10-01', workingDays: [1, 2, 3, 4, 5], blackouts: [] as string[] };

function visit(id: string, date: string, over: Record<string, unknown> = {}) {
  return {
    id,
    customer_id: id,
    customer_name: id,
    address: `${id} Road`,
    postcode: 'LS1 1AA',
    status: 'assigned',
    scheduled_time: null,
    scheduled_date: date,
    quoted_amount: 15,
    final_amount: null,
    ...over,
  };
}

describe('summariseWeek', () => {
  it('summarises each day Monday to Sunday', () => {
    const g = summariseWeek({
      ...base,
      visits: [
        visit('a', '2026-09-29', { status: 'completed' }),
        visit('b', '2026-09-29', { status: 'completed', final_amount: 20 }),
        visit('c', '2026-10-01'),
        visit('d', '2026-10-03'),
      ],
    });
    expect(g.days.map((d) => d.date)).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
    expect(g.days[1]).toMatchObject({ stops: 2, done: 2, amount: 35, isPast: true, isFree: false });
    expect(g.days[3]).toMatchObject({ stops: 1, isToday: true, isFree: false });
    expect(g.days[4]).toMatchObject({ stops: 0, isFree: true }); // Friday, nothing booked
    expect(g.days[5]).toMatchObject({ stops: 1, isDayOff: true, isFree: false }); // Saturday with a visit
    expect(g.days[0]).toMatchObject({ isPast: true, isFree: false }); // an empty day that has gone
    expect(g).toMatchObject({ stops: 4, amount: 65, doneAmount: 35, freeDays: 1 });
  });

  it('treats a blacked-out working day as a day off', () => {
    const g = summariseWeek({ ...base, blackouts: ['2026-10-02'], visits: [] });
    expect(g.days[4]).toMatchObject({ isDayOff: true, isFree: false });
    expect(g.freeDays).toBe(1); // only today
  });
});
