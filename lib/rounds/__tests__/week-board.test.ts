import { describe, expect, it } from 'vitest';
import type { VisitRow } from '@/lib/data/rounds/visits';
import {
  applyLocalMove,
  buildWeeks,
  canDropOn,
  canSwap,
  dropIndex,
  extendRange,
  findHouseMatch,
  initialRange,
  jobAsStop,
  mondayOf,
  orderAfterDrop,
  rangeEnd,
  swapSummary,
  untoldByJob,
  type BoardDay,
} from '@/lib/rounds/week-board';

const TODAY = '2026-10-06'; // a Tuesday
const WORKING = [1, 2, 3, 4, 5];

function visit(over: Partial<VisitRow> & Pick<VisitRow, 'id'>): VisitRow {
  return {
    reference_number: `R-${over.id}`,
    customer_id: over.id,
    customer_name: `Customer ${over.id}`,
    service_agreement_id: null,
    agreement_occurrence_date: null,
    address: `${over.id} High Street, Stockport`,
    postcode: 'M20 1GH',
    lat: null,
    lng: null,
    job_description: 'Window clean',
    status: 'assigned',
    scheduled_date: TODAY,
    scheduled_time: null,
    estimated_duration_minutes: null,
    quoted_amount: 10,
    final_amount: null,
    payment_status: null,
    skip_reason: null,
    route_position: 1,
    completed_at: null,
    customer_confirmation_status: null,
    customer_requested_date: null,
    customer_reply_at: null,
    customer_sends_invoice: false,
    customer_has_email: false,
    ...over,
  };
}

function weeks(visits: VisitRow[], over: Partial<Parameters<typeof buildWeeks>[0]> = {}) {
  return buildWeeks({
    visits,
    from: '2026-10-05',
    weeks: 1,
    today: TODAY,
    workingDays: WORKING,
    blackouts: [],
    ...over,
  });
}

function dayOf(visits: VisitRow[], date: string, over: Partial<Parameters<typeof buildWeeks>[0]> = {}): BoardDay {
  const day = weeks(visits, over)[0]?.days.find((d) => d.date === date);
  if (!day) throw new Error(`no day ${date}`);
  return day;
}

describe('buildWeeks', () => {
  it('gives seven days Monday to Sunday with a w/c label, snapping from back to its Monday', () => {
    const [week] = weeks([], { from: '2026-10-08' });
    expect(week?.weekStart).toBe('2026-10-05');
    expect(week?.label).toBe('w/c 5 Oct');
    expect(week?.days.map((d) => d.date)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
    ]);
    expect(week?.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('flags today, past days and days off (including a blackout), and a day off still lists its stops', () => {
    const [week] = weeks([visit({ id: 'sat', scheduled_date: '2026-10-10' })], { blackouts: ['2026-10-08'] });
    const byDate = Object.fromEntries((week?.days ?? []).map((d) => [d.date, d]));
    expect(byDate['2026-10-06']?.isToday).toBe(true);
    expect(byDate['2026-10-05']?.isPast).toBe(true);
    expect(byDate['2026-10-06']?.isPast).toBe(false);
    expect(byDate['2026-10-10']?.isDayOff).toBe(true);
    expect(byDate['2026-10-10']?.stops).toHaveLength(1);
    expect(byDate['2026-10-08']?.isDayOff).toBe(true);
    expect(byDate['2026-10-07']?.isDayOff).toBe(false);
  });

  it('never shows pending_send or declined visits', () => {
    const day = dayOf(
      [
        visit({ id: 'a' }),
        visit({ id: 'b', status: 'pending_send', route_position: 2 }),
        visit({ id: 'c', status: 'declined', route_position: 3 }),
      ],
      TODAY,
    );
    expect(day.stops.map((s) => s.id)).toEqual(['a']);
  });

  it('makes two services at one house one stop, adds the money, and counts the jobs', () => {
    const day = dayOf(
      [
        visit({ id: 'a', customer_id: 'c1', address: '1 High Street', job_description: 'Windows', quoted_amount: 12 }),
        visit({ id: 'b', customer_id: 'c1', address: '1 High Street', job_description: 'Gutters', quoted_amount: 25, route_position: 2 }),
      ],
      TODAY,
    );
    expect(day.stops).toHaveLength(1);
    expect(day.stops[0]).toMatchObject({
      id: 'a',
      jobIds: ['a', 'b'],
      services: 'Windows, Gutters',
      amount: 37,
      movable: true,
      state: 'planned',
      jobCount: 2,
    });
    expect(day.plannedAmount).toBe(37);
  });

  it('calls a stop with one service done and one open part_done and not movable', () => {
    const day = dayOf(
      [
        visit({ id: 'a', customer_id: 'c1', address: '1 High Street', status: 'completed', payment_status: 'paid' }),
        visit({ id: 'b', customer_id: 'c1', address: '1 High Street', route_position: 2 }),
      ],
      TODAY,
    );
    expect(day.stops[0]).toMatchObject({ state: 'part_done', movable: false, paid: 'paid' });
  });

  it('puts skipped stops last, counts done of total without skipped, and uses the final amount once done', () => {
    const day = dayOf(
      [
        visit({ id: 'k', status: 'cancelled', route_position: 1 }),
        visit({ id: 'a', route_position: 2 }),
        visit({ id: 'd', status: 'completed', route_position: 3, payment_status: 'unpaid', final_amount: 14 }),
      ],
      TODAY,
    );
    expect(day.stops.map((s) => [s.id, s.state, s.movable])).toEqual([
      ['a', 'planned', true],
      ['d', 'done', false],
      ['k', 'skipped', false],
    ]);
    expect(day.total).toBe(2);
    expect(day.done).toBe(1);
    expect(day.stops[1]?.paid).toBe('unpaid');
    expect(day.stops[1]?.amount).toBe(14);
    expect(day.plannedAmount).toBe(24);
  });

  it('reads paid state from completed visits only, and part when mixed', () => {
    const day = dayOf(
      [
        visit({ id: 'a', customer_id: 'c1', address: '1 High Street', status: 'completed', payment_status: 'paid' }),
        visit({ id: 'b', customer_id: 'c1', address: '1 High Street', status: 'completed', payment_status: 'unpaid', route_position: 2 }),
        visit({ id: 'c', customer_id: 'c2', address: '2 High Street', status: 'completed', payment_status: 'partial', route_position: 3 }),
        visit({ id: 'd', customer_id: 'c3', address: '3 High Street', route_position: 4 }),
      ],
      TODAY,
    );
    expect(day.stops.map((s) => s.paid)).toEqual(['part', 'part', null]);
  });

  it('takes the name, street, earliest time as HH:MM, and a reply label', () => {
    const day = dayOf(
      [
        visit({
          id: 'a',
          customer_name: 'Mrs Jones',
          address: '12 Elm Road, Stockport',
          scheduled_time: '10:30:00',
          customer_confirmation_status: 'rescheduled',
          customer_requested_date: '2026-10-08',
        }),
        visit({ id: 'b', customer_name: null, address: '9 Low Road, Stockport', route_position: 2, scheduled_time: '08:15:00' }),
      ],
      TODAY,
    );
    expect(day.stops[0]).toMatchObject({ name: 'Mrs Jones', street: '12 Elm Road', time: '10:30', reply: 'Asked for Thu 8 Oct' });
    expect(day.stops[1]).toMatchObject({ name: '9 Low Road', time: '08:15', reply: null });
  });

  it('words the other replies like the phone', () => {
    const day = dayOf(
      [
        visit({ id: 'a', customer_confirmation_status: 'declined' }),
        visit({ id: 'b', customer_confirmation_status: 'rescheduled', route_position: 2 }),
        visit({ id: 'c', customer_confirmation_status: 'replied', route_position: 3 }),
      ],
      TODAY,
    );
    expect(day.stops.map((s) => s.reply)).toEqual(['Said no', 'Asked to move', 'Sent a message']);
  });

  it('gives seven distinct dates per week across the October clock change', () => {
    const result = weeks([], { from: '2026-10-19', weeks: 2, today: '2026-10-20' });
    for (const week of result) expect(new Set(week.days.map((d) => d.date)).size).toBe(7);
    expect(result[0]?.days.map((d) => d.date)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    expect(result[1]?.weekStart).toBe('2026-10-26');
  });

  it('totals the week stops and money', () => {
    const [week] = weeks([
      visit({ id: 'a', scheduled_date: '2026-10-06' }),
      visit({ id: 'b', scheduled_date: '2026-10-08', quoted_amount: 30 }),
    ]);
    expect(week).toMatchObject({ stops: 2, amount: 40 });
  });
});

describe('ranges', () => {
  it('opens two weeks back and three ahead from this week\'s Monday', () => {
    expect(initialRange(TODAY)).toEqual({ from: '2026-09-21', weeks: 6 });
    expect(mondayOf('2026-10-11')).toBe('2026-10-05');
  });

  it('ends on the last Sunday', () => {
    expect(rangeEnd({ from: '2026-09-21', weeks: 6 })).toBe('2026-11-01');
    expect(rangeEnd({ from: '2026-10-08', weeks: 1 })).toBe('2026-10-11');
  });

  it('extends two weeks either way and never goes past 16 weeks', () => {
    expect(extendRange({ from: '2026-09-21', weeks: 6 }, 'later')).toEqual({ from: '2026-09-21', weeks: 8 });
    expect(extendRange({ from: '2026-09-21', weeks: 6 }, 'earlier')).toEqual({ from: '2026-09-07', weeks: 8 });
    expect(extendRange({ from: '2026-09-21', weeks: 16 }, 'later')).toEqual({ from: '2026-10-05', weeks: 16 });
    expect(extendRange({ from: '2026-09-21', weeks: 16 }, 'earlier')).toEqual({ from: '2026-09-07', weeks: 16 });
  });
});

describe('dropIndex', () => {
  it('counts the card midpoints before the drop position', () => {
    const mids = [50, 150, 250];
    expect(dropIndex(mids, 0)).toBe(0);
    expect(dropIndex(mids, 100)).toBe(1);
    expect(dropIndex(mids, 200)).toBe(2);
    expect(dropIndex(mids, 999)).toBe(3);
    expect(dropIndex([], 10)).toBe(0);
  });
});

describe('orderAfterDrop', () => {
  const target = dayOf(
    [
      visit({ id: 'a', route_position: 1 }),
      visit({ id: 'b', route_position: 2 }),
      visit({ id: 'c', route_position: 3 }),
      visit({ id: 'k', status: 'cancelled', route_position: 4 }),
    ],
    TODAY,
  );
  const incoming = dayOf(
    [
      visit({ id: 'x1', customer_id: 'cx', address: '9 X Road', scheduled_date: '2026-10-08', route_position: 1 }),
      visit({ id: 'x2', customer_id: 'cx', address: '9 X Road', scheduled_date: '2026-10-08', route_position: 2 }),
    ],
    '2026-10-08',
  ).stops[0]!;

  it('inserts a stop from another day at the spot, as all its visit ids kept together', () => {
    expect(orderAfterDrop({ target, dragged: incoming, index: 1 })).toEqual(['a', 'x1', 'x2', 'b', 'c', 'k']);
    expect(orderAfterDrop({ target, dragged: incoming, index: 0 })[0]).toBe('x1');
  });

  it('a drop past the end lands after the last stop but before skipped ones', () => {
    expect(orderAfterDrop({ target, dragged: incoming, index: 99 })).toEqual(['a', 'b', 'c', 'x1', 'x2', 'k']);
  });

  it('moves within a day, taking the dragged stop out first', () => {
    expect(orderAfterDrop({ target, dragged: target.stops[2]!, index: 0 })).toEqual(['c', 'a', 'b', 'k']);
  });

  it('dropping a stop at its own place returns the same order', () => {
    expect(orderAfterDrop({ target, dragged: target.stops[1]!, index: 1 })).toEqual(['a', 'b', 'c', 'k']);
  });
});

describe('a stop dropped on a day where the same house already is', () => {
  const visits = [
    visit({ id: 'w', customer_id: 'c1', address: '1 High Street', scheduled_date: '2026-10-06', job_description: 'Windows' }),
    visit({ id: 'o', customer_id: 'c2', address: '2 Low Road', scheduled_date: '2026-10-08', route_position: 1 }),
    visit({ id: 'g', customer_id: 'c1', address: '1 High Street', scheduled_date: '2026-10-08', route_position: 2, job_description: 'Gutters' }),
    visit({ id: 'z', customer_id: 'c3', address: '3 Mill Lane', scheduled_date: '2026-10-08', route_position: 3 }),
  ];
  const thu = dayOf(visits, '2026-10-08');
  const dragged = dayOf(visits, '2026-10-06').stops[0]!;

  it('finds the existing stop of the same house, and nothing for a different house or a skipped one', () => {
    expect(findHouseMatch(thu, dragged)?.id).toBe('g');
    expect(findHouseMatch(thu, dayOf([visit({ id: 'q', customer_id: 'c9', address: '9 Far Road' })], TODAY).stops[0]!)).toBeNull();
    const skipped = dayOf(
      [...visits.filter((v) => v.id !== 'g'), visit({ id: 'g', customer_id: 'c1', address: '1 High Street', scheduled_date: '2026-10-08', status: 'cancelled', route_position: 2 })],
      '2026-10-08',
    );
    expect(findHouseMatch(skipped, dragged)).toBeNull();
  });

  it("puts the dragged visits right after the existing stop's own, so the card stays one", () => {
    const into = findHouseMatch(thu, dragged)!;
    expect(orderAfterDrop({ target: thu, dragged, index: 0, mergeInto: into })).toEqual(['o', 'g', 'w', 'z']);
  });
});

describe('canDropOn, canSwap, swapSummary', () => {
  const visits = [
    visit({ id: 't1', scheduled_date: '2026-10-06', route_position: 1 }),
    visit({ id: 't2', scheduled_date: '2026-10-06', route_position: 2 }),
    visit({ id: 't3', scheduled_date: '2026-10-06', status: 'completed', route_position: 3 }),
    visit({ id: 'h1', scheduled_date: '2026-10-08', route_position: 1 }),
    visit({ id: 'p1', scheduled_date: '2026-10-05', route_position: 1 }),
  ];
  const [week] = weeks(visits);
  const day = (date: string) => week!.days.find((d) => d.date === date)!;

  it('past days are not drop targets', () => {
    expect(canDropOn(day('2026-10-05'))).toBe(false);
    expect(canDropOn(day('2026-10-06'))).toBe(true);
  });

  it('can swap two different future days when one has a movable stop, never a past day or the same day', () => {
    expect(canSwap(day('2026-10-06'), day('2026-10-08'))).toBe(true);
    expect(canSwap(day('2026-10-06'), day('2026-10-09'))).toBe(true);
    expect(canSwap(day('2026-10-09'), day('2026-10-07'))).toBe(false);
    expect(canSwap(day('2026-10-05'), day('2026-10-08'))).toBe(false);
    expect(canSwap(day('2026-10-06'), day('2026-10-06'))).toBe(false);
  });

  it('describes the swap with movable stop counts only', () => {
    expect(swapSummary(day('2026-10-06'), day('2026-10-08'))).toBe('Swap Tue 6 Oct (2 stops) with Thu 8 Oct (1 stop)?');
  });
});

describe('applyLocalMove', () => {
  const visits = [
    visit({ id: 'a', scheduled_date: TODAY, route_position: 1 }),
    visit({ id: 'b', scheduled_date: TODAY, route_position: 2 }),
    visit({ id: 'x', scheduled_date: '2026-10-08', route_position: 1 }),
    visit({ id: 'y', scheduled_date: '2026-10-08', route_position: 2 }),
  ];

  it('moves a stop to another day at the dropped spot', () => {
    const next = applyLocalMove(visits, { jobIds: ['a'], toDate: '2026-10-08', orderedJobIds: ['x', 'a', 'y'] });
    expect(dayOf(next, '2026-10-08').stops.map((s) => s.id)).toEqual(['x', 'a', 'y']);
    expect(dayOf(next, TODAY).stops.map((s) => s.id)).toEqual(['b']);
  });

  it('reorders inside one day and leaves the originals alone', () => {
    const next = applyLocalMove(visits, { jobIds: [], toDate: TODAY, orderedJobIds: ['b', 'a'] });
    expect(dayOf(next, TODAY).stops.map((s) => s.id)).toEqual(['b', 'a']);
    expect(visits[0]?.route_position).toBe(1);
  });
});

describe('untoldByJob and the Not told tag', () => {
  const swap = {
    changeId: 'c1',
    kind: 'swap_days' as const,
    fromDate: '2026-10-06',
    toDate: '2026-10-08',
    createdAt: '2026-10-05T10:00:00Z',
    jobs: [
      { jobId: 'a', fromDate: '2026-10-06' },
      { jobId: 'b', fromDate: '2026-10-08' },
    ],
  };

  it('tags visits still where a swap left them, each on the other day', () => {
    const visits = [visit({ id: 'a', scheduled_date: '2026-10-08' }), visit({ id: 'b', scheduled_date: '2026-10-06' })];
    expect([...untoldByJob([swap], visits, TODAY).entries()]).toEqual([['a', 'c1'], ['b', 'c1']]);
  });

  it('leaves out a visit that has moved again, been done, or is now in the past', () => {
    const visits = [visit({ id: 'a', scheduled_date: '2026-10-09' }), visit({ id: 'b', scheduled_date: '2026-10-06', status: 'completed' })];
    expect(untoldByJob([swap], visits, TODAY).size).toBe(0);
    expect(untoldByJob([swap], [visit({ id: 'a', scheduled_date: '2026-10-08' })], '2026-10-09').size).toBe(0);
  });

  it('puts the change id on the stop that buildWeeks returns', () => {
    const visits = [visit({ id: 'a', scheduled_date: '2026-10-08' }), visit({ id: 'z', scheduled_date: '2026-10-08', route_position: 2 })];
    const untold = untoldByJob([swap], visits, TODAY);
    expect(dayOf(visits, '2026-10-08', { untold }).stops.map((s) => s.untoldChangeId)).toEqual(['c1', null]);
  });
});

describe('moving one job of a combined card', () => {
  const visits = [
    visit({ id: 'w', customer_id: 'c1', address: '1 High Street', job_description: 'Windows', quoted_amount: 12, route_position: 1 }),
    visit({ id: 'g', customer_id: 'c1', address: '1 High Street', job_description: 'Gutters', quoted_amount: 25, route_position: 2 }),
  ];
  const stop = dayOf(visits, TODAY).stops[0]!;

  it('lists each job on the card with its own money and state', () => {
    expect(stop.jobs.map((j) => [j.id, j.services, j.amount, j.state, j.movable])).toEqual([
      ['w', 'Windows', 12, 'planned', true],
      ['g', 'Gutters', 25, 'planned', true],
    ]);
  });

  it('turns one job into a stop of its own, keeping the house, with just its own money and id', () => {
    const one = jobAsStop(stop, 'g')!;
    expect(one).toMatchObject({ id: 'g', jobIds: ['g'], services: 'Gutters', amount: 25, jobCount: 1, movable: true, house: stop.house });
    expect(one.name).toBe('Customer w · Gutters');
    expect(jobAsStop(stop, 'nope')).toBeNull();
  });

  it('lets the open job move on its own when its sibling is already done', () => {
    const half = dayOf(
      [visits[0]!, { ...visits[1]!, status: 'completed' }],
      TODAY,
    ).stops[0]!;
    expect(half.movable).toBe(false);
    expect(jobAsStop(half, 'w')?.movable).toBe(true);
    expect(jobAsStop(half, 'g')?.movable).toBe(false);
  });

  it('moving one job leaves the other as a card of its own and joins an existing visit at the new day', () => {
    const moved = applyLocalMove(visits, { jobIds: ['g'], toDate: '2026-10-08', orderedJobIds: ['g'] });
    expect(dayOf(moved, TODAY).stops.map((s) => s.jobIds)).toEqual([['w']]);
    expect(dayOf(moved, '2026-10-08').stops.map((s) => s.jobIds)).toEqual([['g']]);
  });
});
