import { describe, expect, it } from 'vitest';
import { filterByPerson, groupIntoLanes, parsePersonParam, personColours, personScope, type LanePerson } from '../lanes';

const owner: LanePerson = { workerId: 'wo', name: 'You', isOwner: true };
const dave: LanePerson = { workerId: 'wd', name: 'Dave', isOwner: false };
const anna: LanePerson = { workerId: 'wa', name: 'Anna', isOwner: false };
const people = [dave, owner, anna];

const stop = (id: string, who: string | null) => ({ id, assigned_worker_id: who });

describe('groupIntoLanes', () => {
  it('puts You first, then leads A to Z, and sorts stops into their lanes', () => {
    const lanes = groupIntoLanes([stop('1', 'wd'), stop('2', 'wo'), stop('3', 'wa'), stop('4', 'wd')], people, new Set());
    expect(lanes.map((l) => l.name)).toEqual(['You', 'Anna', 'Dave']);
    expect(lanes.find((l) => l.name === 'Dave')!.stops.map((s) => s.id)).toEqual(['1', '4']);
  });

  it('gives an unassigned or unknown assignee to the owner', () => {
    const lanes = groupIntoLanes([stop('1', null), stop('2', 'someone-removed')], people, new Set());
    expect(lanes[0]!.stops.map((s) => s.id)).toEqual(['1', '2']);
  });

  it('flags a person who is off and keeps their stops visible', () => {
    const lanes = groupIntoLanes([stop('1', 'wd')], people, new Set(['wd']));
    const d = lanes.find((l) => l.name === 'Dave')!;
    expect(d.off).toBe(true);
    expect(d.stops).toHaveLength(1);
  });

  it('still makes an owner lane when the owner is missing from the list', () => {
    const lanes = groupIntoLanes([stop('1', null)], [dave], new Set());
    expect(lanes[0]).toMatchObject({ isOwner: true, name: 'You' });
    expect(lanes[0]!.stops).toHaveLength(1);
  });
});

describe('personColours', () => {
  it('is stable: owner slate, leads take the palette A to Z', () => {
    const c = personColours(people);
    expect(c.get('wo')).toBe('slate');
    expect(c.get('wa')).not.toBe(c.get('wd'));
    expect(personColours([...people].reverse()).get('wd')).toBe(c.get('wd'));
  });
});

describe('filterByPerson', () => {
  const stops = [stop('1', 'wd'), stop('2', 'wo'), stop('3', null), stop('4', 'wa')];
  it('all keeps everything', () => {
    expect(filterByPerson(stops, 'all', people)).toHaveLength(4);
  });
  it('mine is the owner plus unassigned', () => {
    expect(filterByPerson(stops, 'mine', people).map((s) => s.id)).toEqual(['2', '3']);
    expect(filterByPerson(stops, 'wo', people).map((s) => s.id)).toEqual(['2', '3']);
  });
  it("a worker id is that person's stops only", () => {
    expect(filterByPerson(stops, 'wd', people).map((s) => s.id)).toEqual(['1']);
  });
});

describe('parsePersonParam / personScope', () => {
  it('accepts all, mine and a real lead; anything else is all', () => {
    expect(parsePersonParam(undefined, people)).toBe('all');
    expect(parsePersonParam('mine', people)).toBe('mine');
    expect(parsePersonParam('wd', people)).toBe('wd');
    expect(parsePersonParam('wo', people)).toBe('all');
    expect(parsePersonParam('nobody', people)).toBe('all');
  });
  it('scope is null for Everyone, the owner for mine, the person otherwise', () => {
    expect(personScope('all', people)).toBeNull();
    expect(personScope('mine', people)).toBe('wo');
    expect(personScope('wd', people)).toBe('wd');
  });
});
