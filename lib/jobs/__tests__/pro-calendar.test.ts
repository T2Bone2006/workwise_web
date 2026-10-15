import { describe, expect, it } from 'vitest';
import {
  canGive,
  canMove,
  countJobs,
  dayChips,
  dayLanes,
  dayOrderAfterLaneDrop,
  daysOfWeek,
  fetchWindow,
  filterJobs,
  giveChoices,
  groupColour,
  jobsByPerson,
  jobState,
  mergeJobs,
  nameMatches,
  pickPeople,
  layOutDay,
  monthCells,
  needsYou,
  orderAfterDrop,
  orderAfterFilteredDrop,
  parseCalendarView,
  parsePersonFilter,
  peopleOn,
  streetOf,
  rangeLabel,
  shiftAnchor,
  showingToday,
  weekBounds,
  type ProCalendarJob,
} from '@/lib/jobs/pro-calendar';

function job(over: Partial<ProCalendarJob> & Pick<ProCalendarJob, 'id'>): ProCalendarJob {
  return {
    reference: null,
    title: over.id,
    postcode: null,
    customer: null,
    worker: null,
    workerId: null,
    status: 'pending',
    priority: 'normal',
    time: null,
    date: '2026-10-14',
    detail: null,
    groupId: null,
    groupLabel: null,
    position: null,
    ...over,
  };
}

describe('parseCalendarView', () => {
  it('opens on the week, and keeps a real view', () => {
    expect(parseCalendarView(undefined)).toBe('week');
    expect(parseCalendarView('nope')).toBe('week');
    expect(parseCalendarView('day')).toBe('day');
    expect(parseCalendarView('month')).toBe('month');
    expect(parseCalendarView('board')).toBe('week');
  });
});

describe('dates', () => {
  it('builds the Monday–Sunday week around a Wednesday', () => {
    expect(weekBounds('2026-10-14')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(daysOfWeek('2026-10-14')[0]).toBe('2026-10-12');
    expect(daysOfWeek('2026-10-14')).toHaveLength(7);
  });

  it('steps a day, a week, or a month', () => {
    expect(shiftAnchor('day', '2026-10-14', 1)).toBe('2026-10-15');
    expect(shiftAnchor('week', '2026-10-14', -1)).toBe('2026-10-07');
    expect(shiftAnchor('week', '2026-10-14', 1)).toBe('2026-10-21');
    expect(shiftAnchor('month', '2026-10-14', 1)).toBe('2026-11-01');
    expect(shiftAnchor('month', '2026-10-14', -1)).toBe('2026-09-01');
  });

  it('knows when the window already shows today', () => {
    expect(showingToday('day', '2026-10-14', '2026-10-14')).toBe(true);
    expect(showingToday('week', '2026-10-14', '2026-10-12')).toBe(true);
    expect(showingToday('week', '2026-10-14', '2026-10-19')).toBe(false);
    expect(showingToday('month', '2026-10-14', '2026-10-01')).toBe(true);
    expect(showingToday('month', '2026-10-14', '2026-11-01')).toBe(false);
  });

  it('loads the month grid, including the days that spill into the next month', () => {
    const cells = monthCells('2026-10-14');
    expect(cells[0]).toEqual({ ymd: '2026-09-28', inMonth: false });
    expect(cells.find((c) => c.ymd === '2026-10-01')?.inMonth).toBe(true);
    expect(cells[cells.length - 1]!.ymd).toBe('2026-11-01');
    expect(fetchWindow('month', '2026-10-14')).toEqual({ from: '2026-09-28', to: '2026-11-01' });
    expect(fetchWindow('day', '2026-10-14')).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    // Like the Rounds board: two weeks back, this week and three ahead.
    expect(fetchWindow('week', '2026-10-14')).toEqual({ from: '2026-09-28', to: '2026-11-08' });
  });

  it('labels the week and the month', () => {
    expect(rangeLabel('week', '2026-10-14')).toBe('12–18 Oct 2026');
    expect(rangeLabel('month', '2026-10-14')).toBe('October 2026');
    expect(rangeLabel('day', '2026-10-14')).toBe('Wednesday 14 October 2026');
  });
});

describe('orderAfterDrop', () => {
  it('inserts the moved jobs at the gap, and takes them out of where they were', () => {
    expect(orderAfterDrop(['a', 'b', 'c', 'd'], ['b'], 0)).toEqual(['b', 'a', 'c', 'd']);
    expect(orderAfterDrop(['a', 'b', 'c', 'd'], ['b'], 2)).toEqual(['a', 'c', 'b', 'd']);
    expect(orderAfterDrop(['a', 'b', 'c'], ['a', 'c'], 1)).toEqual(['b', 'a', 'c']);
  });
});

describe('layOutDay', () => {
  it('draws two or more jobs from the same group as one box, and leaves a single one loose', () => {
    const segments = layOutDay([
      job({ id: 'a', time: '09:00', groupId: 'g1', groupLabel: 'High street' }),
      job({ id: 'b', time: '11:00' }),
      job({ id: 'c', time: '10:00', groupId: 'g1', groupLabel: 'High street' }),
      job({ id: 'd', time: '08:00', groupId: 'g2', groupLabel: 'Alone' }),
    ]);
    expect(segments.map((s) => (s.kind === 'group' ? `group:${s.group.name}` : s.jobs.map((j) => j.id).join(',')))).toEqual([
      'd',
      'group:High street',
      'b',
    ]);
    const group = segments[1];
    expect(group?.kind).toBe('group');
    if (group?.kind === 'group') {
      expect(group.jobs.map((j) => j.id)).toEqual(['a', 'c']);
      expect(group.group.colour).toBe(groupColour('g1'));
    }
  });

  it('keeps the same colour for a group', () => {
    expect(groupColour('g1')).toBe(groupColour('g1'));
    expect(groupColour('g1')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('dayChips', () => {
  it('counts each group and the jobs that are not in one', () => {
    const chips = dayChips([
      job({ id: 'a', groupId: 'g1', groupLabel: 'North' }),
      job({ id: 'b', groupId: 'g1', groupLabel: 'North' }),
      job({ id: 'c' }),
      job({ id: 'd', groupId: 'g2', groupLabel: 'South' }),
    ]);
    expect(chips.total).toBe(4);
    expect(chips.loose).toBe(1);
    expect(chips.groups.map((g) => [g.name, g.count])).toEqual([
      ['North', 2],
      ['South', 1],
    ]);
  });
});

describe('jobState', () => {
  it('says what the office has to do, and what the worker is doing', () => {
    expect(jobState({ status: 'pending', workerId: null })).toBe('no_one');
    expect(jobState({ status: 'pending_send', workerId: 'w1' })).toBe('not_sent');
    expect(jobState({ status: 'assigned', workerId: 'w1' })).toBe('sent');
    expect(jobState({ status: 'accepted', workerId: 'w1' })).toBe('accepted');
    expect(jobState({ status: 'in_progress', workerId: 'w1' })).toBe('in_progress');
    expect(jobState({ status: 'declined', workerId: 'w1' })).toBe('declined');
    expect(jobState({ status: 'completed', workerId: 'w1' })).toBe('done');
    expect(needsYou({ status: 'pending_send', workerId: 'w1' })).toBe(true);
    expect(needsYou({ status: 'accepted', workerId: 'w1' })).toBe(false);
  });

  it('keeps the day of a job that is under way or finished, and only hands over jobs the jobs list would', () => {
    expect(canMove({ status: 'assigned' })).toBe(true);
    expect(canMove({ status: 'in_progress' })).toBe(false);
    expect(canMove({ status: 'completed' })).toBe(false);
    expect(canGive({ status: 'declined' })).toBe(true);
    expect(canGive({ status: 'accepted' })).toBe(false);
  });
});

describe('people', () => {
  const workers = [
    { id: 'w1', name: 'Dave Smith' },
    { id: 'w2', name: 'Amy Jones' },
    { id: 'w3', name: 'Zed Brown' },
  ];

  it('puts jobs no one has (declined ones too) first, then a lane per person A to Z', () => {
    const lanes = dayLanes(
      [
        job({ id: 'a', workerId: 'w1', worker: 'Dave Smith', status: 'assigned' }),
        job({ id: 'b' }),
        job({ id: 'c', workerId: 'w2', worker: 'Amy Jones', status: 'declined' }),
        job({ id: 'd', workerId: 'w2', worker: 'Amy Jones', status: 'accepted' }),
      ],
      workers,
      false,
    );
    expect(lanes.map((lane) => [lane.key, lane.jobs.map((j) => j.id).join(',')])).toEqual([
      ['none', 'b,c'],
      ['w2', 'd'],
      ['w1', 'a'],
    ]);
    expect(dayLanes([], workers, true).map((lane) => lane.name)).toEqual(['Amy Jones', 'Dave Smith', 'Zed Brown']);
  });

  it('counts who has work on a day, and filters to one person or to no one', () => {
    const list = [
      job({ id: 'a', workerId: 'w1', worker: 'Dave Smith', status: 'assigned' }),
      job({ id: 'b', workerId: 'w1', worker: 'Dave Smith', status: 'accepted' }),
      job({ id: 'c' }),
    ];
    expect(peopleOn(list)).toEqual({ people: [{ workerId: 'w1', name: 'Dave Smith', count: 2 }], noOne: 1 });
    expect(filterJobs(list, 'none').map((j) => j.id)).toEqual(['c']);
    expect(filterJobs(list, 'w1').map((j) => j.id)).toEqual(['a', 'b']);
    expect(parsePersonFilter('w9', workers)).toBe('all');
    expect(parsePersonFilter('none', workers)).toBe('none');
    expect(countJobs(list)).toEqual({ total: 3, done: 0, noOne: 1, notSent: 0, declined: 0 });
  });
});

describe('streetOf', () => {
  it('drops the postcode and the town so the card leads with the street', () => {
    expect(streetOf('48 Gainsford Road London E17 6QB', 'E17 6QB')).toBe('48 Gainsford Road London');
    expect(streetOf('12 High St, Leeds, LS1 4AB', 'LS1 4AB')).toBe('12 High St');
    expect(streetOf('11 Cross Street', 'WA3 3PD')).toBe('11 Cross Street');
  });
});

describe('dropping with a filter or into a lane', () => {
  it('keeps the hidden jobs in their places when only some of the day is on screen', () => {
    // a and c are Dave's (on screen); b is Amy's (hidden).
    expect(orderAfterFilteredDrop(['a', 'b', 'c'], ['a', 'c'], ['x'], 1)).toEqual(['a', 'b', 'x', 'c']);
    expect(orderAfterFilteredDrop(['a', 'b', 'c'], ['a', 'c'], ['x'], 2)).toEqual(['a', 'b', 'c', 'x']);
    expect(orderAfterFilteredDrop(['a', 'b'], ['a', 'b'], ['b'], 0)).toEqual(['b', 'a']);
  });

  it('moves a job into another lane and reads the day lane by lane', () => {
    const lanes = [
      { key: 'none', ids: ['n1'] },
      { key: 'w1', ids: ['a', 'b'] },
      { key: 'w2', ids: ['c'] },
    ];
    expect(dayOrderAfterLaneDrop(lanes, 'w2', ['a'], 0)).toEqual(['n1', 'b', 'a', 'c']);
    expect(dayOrderAfterLaneDrop(lanes, 'w1', ['n1'], 2)).toEqual(['a', 'b', 'n1', 'c']);
  });
});

describe('big teams', () => {
  const people = [
    { id: 'w1', name: 'Dave Smith' },
    { id: 'w2', name: 'Amy Jones' },
    { id: 'w3', name: "Sean O'Neill" },
    { id: 'w4', name: 'Zara Ali' },
  ];
  const day = [
    job({ id: 'a', workerId: 'w1', worker: 'Dave Smith', status: 'assigned' }),
    job({ id: 'b', workerId: 'w1', worker: 'Dave Smith', status: 'assigned' }),
    job({ id: 'c', workerId: 'w2', worker: 'Amy Jones', status: 'assigned' }),
    job({ id: 'd', workerId: 'w4', worker: 'Zara Ali', status: 'declined' }),
    job({ id: 'e' }),
  ];

  it('counts jobs per person, and a declined job is no one’s', () => {
    expect(Object.fromEntries(jobsByPerson(day))).toEqual({ w1: 2, w2: 1 });
  });

  it('finds people by the start of any of their names', () => {
    expect(nameMatches('Dave Smith', 'da')).toBe(true);
    expect(nameMatches('Dave Smith', 'da sm')).toBe(true);
    expect(nameMatches('Dave Smith', 'smi')).toBe(true);
    expect(nameMatches('Dave Smith', 'ave')).toBe(false);
    expect(nameMatches("Sean O'Neill", 'neill')).toBe(true);
    expect(nameMatches('Anyone', '   ')).toBe(true);
  });

  it('shows who is working, who is free, or everyone, by name or fewest jobs first', () => {
    const lanes = dayLanes(day, people, true);
    const names = (show: 'working' | 'free' | 'everyone', sort: 'name' | 'fewest', query = '') =>
      pickPeople(lanes, { query, show, sort }).map((lane) => lane.name);
    expect(names('working', 'name')).toEqual(['Amy Jones', 'Dave Smith']);
    expect(names('working', 'fewest')).toEqual(['Amy Jones', 'Dave Smith']);
    expect(names('free', 'name')).toEqual(["Sean O'Neill", 'Zara Ali']);
    expect(names('everyone', 'fewest')).toEqual(["Sean O'Neill", 'Zara Ali', 'Amy Jones', 'Dave Smith']);
    expect(names('everyone', 'name', 'z')).toEqual(['Zara Ali']);
    // The "no one yet" lane is never a person row.
    expect(pickPeople(lanes, { query: '', show: 'everyone', sort: 'name' }).every((lane) => lane.workerId)).toBe(true);
  });

  it('offers people already out with the fewest jobs first, then whoever is free', () => {
    const { working, free } = giveChoices(people, jobsByPerson(day), '');
    expect(working.map((c) => [c.worker.name, c.count])).toEqual([
      ['Amy Jones', 1],
      ['Dave Smith', 2],
    ]);
    expect(free.map((c) => c.worker.name)).toEqual(["Sean O'Neill", 'Zara Ali']);
    expect(giveChoices(people, new Map(), 'zar').free.map((c) => c.worker.id)).toEqual(['w4']);
  });
});

describe('mergeJobs', () => {
  const before = [
    job({ id: 'old-in', date: '2026-10-14' }),
    job({ id: 'far', date: '2026-12-01' }),
    job({ id: 'tray', date: null }),
    job({ id: 'moved', date: '2026-12-02' }),
  ];

  it('replaces the loaded dates and keeps the weeks loaded by scrolling', () => {
    const fresh = [job({ id: 'new-in', date: '2026-10-15' }), job({ id: 'tray2', date: null })];
    const ids = mergeJobs(before, fresh, { from: '2026-10-12', to: '2026-10-18', undated: true }).map((j) => j.id);
    expect(ids.sort()).toEqual(['far', 'moved', 'new-in', 'tray2']);
  });

  it('leaves the jobs with no date alone when only weeks are loaded', () => {
    const fresh = [job({ id: 'moved', date: '2026-12-03' })];
    const merged = mergeJobs(before, fresh, { from: '2026-11-30', to: '2026-12-13', undated: false });
    expect(merged.map((j) => j.id).sort()).toEqual(['moved', 'old-in', 'tray']);
    expect(merged.find((j) => j.id === 'moved')?.date).toBe('2026-12-03');
  });
});
