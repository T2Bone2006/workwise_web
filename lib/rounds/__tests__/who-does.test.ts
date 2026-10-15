import { describe, expect, it } from 'vitest';
import { dayPeople, expectedForStop, needsPersonTag, personOfStop, whoDoes } from '@/lib/rounds/who-does';

const OWNER = 'w-owner';
const stop = (who: string | null, state?: string) => ({ visits: [{ assigned_worker_id: who }], state });

describe('who does', () => {
  it('treats a visit with no person as the owner', () => {
    expect(personOfStop(stop(null), OWNER)).toBe(OWNER);
    expect(personOfStop(stop('w-dave'), OWNER)).toBe('w-dave');
  });

  it('names the person with most of a round, and counts the others', () => {
    expect(whoDoes([stop('w-dave'), stop('w-dave'), stop('w-dave')], OWNER)).toEqual({ workerId: 'w-dave', others: 0 });
    expect(whoDoes([stop('w-dave'), stop('w-dave'), stop('w-lee')], OWNER)).toEqual({ workerId: 'w-dave', others: 1 });
    expect(whoDoes([stop(null), stop('w-dave'), stop('w-lee')], OWNER).others).toBe(2);
  });

  it('only tags a card whose person is not the expected one', () => {
    expect(needsPersonTag('w-dave', 'w-dave')).toBe(false);
    expect(needsPersonTag('w-lee', 'w-dave')).toBe(true);
  });

  it('expects the round’s usual person, else the owner', () => {
    expect(expectedForStop({ leadWorkerId: 'w-dave' }, OWNER)).toBe('w-dave');
    expect(expectedForStop({ leadWorkerId: null }, OWNER)).toBe(OWNER);
    expect(expectedForStop(null, OWNER)).toBe(OWNER);
  });

  it('lists who has stops on a day: the owner first, skipped stops not counted', () => {
    const people = dayPeople([stop('w-dave'), stop('w-dave'), stop(null), stop('w-lee', 'skipped')], OWNER);
    expect(people).toEqual([
      { workerId: OWNER, stops: 1 },
      { workerId: 'w-dave', stops: 2 },
    ]);
  });
});
