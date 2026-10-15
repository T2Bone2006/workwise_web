import { describe, expect, it } from 'vitest';
import { friendlyTime, listTodayStops, summariseToday, type RoundVisit } from '@/lib/rounds/today-strip';

function visit(over: Partial<RoundVisit> & { id: string }): RoundVisit {
  return {
    customer_id: over.id,
    customer_name: `Customer ${over.id}`,
    address: `${over.id} Elm Road, Leeds`,
    postcode: 'LS1 1AA',
    status: 'assigned',
    scheduled_time: null,
    job_description: 'Window clean',
    quoted_amount: 15,
    final_amount: null,
    ...over,
  };
}

describe('friendlyTime', () => {
  it('formats times the way people say them', () => {
    expect(friendlyTime('14:10:00')).toBe('2:10pm');
    expect(friendlyTime('09:05')).toBe('9:05am');
    expect(friendlyTime('00:30:00')).toBe('12:30am');
    expect(friendlyTime('12:00:00')).toBe('12:00pm');
    expect(friendlyTime(null)).toBeNull();
    expect(friendlyTime('soon')).toBeNull();
  });
});

describe('summariseToday', () => {
  it('counts stops, done, skipped and money, and names the next one in route order', () => {
    const s = summariseToday([
      visit({ id: '1', status: 'completed', final_amount: 18 }),
      visit({ id: '2', status: 'cancelled' }),
      visit({ id: '3', scheduled_time: '14:10:00', quoted_amount: 20 }),
      visit({ id: '4' }),
      visit({ id: '5' }),
      visit({ id: '6' }),
      visit({ id: '7' }),
    ]);
    expect(s).toMatchObject({ stops: 6, done: 1, skipped: 1, toGo: 5, plannedAmount: 98, doneAmount: 18 });
    expect(s.next).toEqual({ customerName: 'Customer 3', street: '3 Elm Road', time: '2:10pm', work: 'Window clean', amount: 20 });
    expect(s.upNext.map((p) => p.customerName)).toEqual(['Customer 4', 'Customer 5', 'Customer 6']);
  });

  it('counts one house with two visits as one stop, and joins its work', () => {
    const s = summariseToday([
      visit({ id: '1', customer_id: 'c', address: '1 Elm Road', job_description: 'Front' }),
      visit({ id: '2', customer_id: 'c', address: '1 Elm Road', job_description: 'Conservatory roof', quoted_amount: 25 }),
    ]);
    expect(s.stops).toBe(1);
    expect(s.next).toMatchObject({ work: 'Front, Conservatory roof', amount: 40 });
  });

  it('has no next stop when everything is done or skipped', () => {
    expect(summariseToday([visit({ id: '1', status: 'completed' }), visit({ id: '2', status: 'cancelled' })])).toMatchObject({
      stops: 1,
      done: 1,
      skipped: 1,
      toGo: 0,
      next: null,
      upNext: [],
    });
  });

  it('copes with an empty day', () => {
    expect(summariseToday([])).toMatchObject({ stops: 0, done: 0, toGo: 0, plannedAmount: 0, next: null });
  });
});

describe('listTodayStops', () => {
  it('lists every house in route order with its state, and agrees with summariseToday', () => {
    const visits = [
      visit({ id: '1', status: 'completed', final_amount: 18 }),
      visit({ id: '2', status: 'cancelled', quoted_amount: 12 }),
      visit({ id: '3', scheduled_time: '14:10:00', quoted_amount: 20 }),
      visit({ id: '4' }),
    ];
    const rows = listTodayStops(visits);
    expect(rows.map((r) => r.state)).toEqual(['done', 'skipped', 'next', 'todo']);
    expect(rows[0]!.amount).toBe(18);
    expect(rows[2]).toMatchObject({ customerName: 'Customer 3', street: '3 Elm Road', time: '2:10pm', amount: 20 });
    const s = summariseToday(visits);
    expect(rows.filter((r) => r.state === 'done').length).toBe(s.done);
    expect(rows.filter((r) => r.state === 'skipped').length).toBe(s.skipped);
    expect(rows.filter((r) => r.state === 'next' || r.state === 'todo').length).toBe(s.toGo);
  });

  it('puts several visits at one house on one row', () => {
    const rows = listTodayStops([
      visit({ id: 'a', customer_id: 'c', address: '9 Elm Road', job_description: 'Windows', quoted_amount: 15 }),
      visit({ id: 'b', customer_id: 'c', address: '9 Elm Road', job_description: 'Conservatory roof', quoted_amount: 30 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'next', work: 'Windows, Conservatory roof', amount: 45 });
  });

  it('has no next stop when everything is done', () => {
    const rows = listTodayStops([visit({ id: '1', status: 'completed' })]);
    expect(rows.map((r) => r.state)).toEqual(['done']);
  });
});
