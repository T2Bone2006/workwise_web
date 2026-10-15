import { describe, expect, it } from 'vitest';
import { roundOfVisits, segmentByRound, type RoundTag } from '@/lib/rounds/round-groups';

const A: RoundTag = { id: 'a', name: 'Tuesday north', colour: '#7c3aed' };
const B: RoundTag = { id: 'b', name: 'Estate', colour: '#0891b2' };
const s = (id: string, round: RoundTag | null) => ({ id, round });

describe('segmentByRound', () => {
  it('groups a run of two or more from one round and keeps the order', () => {
    const out = segmentByRound([s('1', A), s('2', A), s('3', A), s('4', null)]);
    expect(out.map((g) => [g.round?.id ?? null, g.stops.map((x) => x.id)])).toEqual([
      ['a', ['1', '2', '3']],
      [null, ['4']],
    ]);
  });

  it('leaves a lone house of a round as a plain stop', () => {
    const out = segmentByRound([s('1', null), s('2', A), s('3', null)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.round).toBeNull();
    expect(out[0]!.stops.map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('does not group stops of the same round that are split by another house', () => {
    const out = segmentByRound([s('1', A), s('2', null), s('3', A)]);
    expect(out.every((g) => g.round === null)).toBe(true);
    expect(out.flatMap((g) => g.stops.map((x) => x.id))).toEqual(['1', '2', '3']);
  });

  it('makes separate groups for two rounds back to back', () => {
    const out = segmentByRound([s('1', A), s('2', A), s('3', B), s('4', B)]);
    expect(out.map((g) => g.round?.id)).toEqual(['a', 'b']);
  });

  it('is empty for no stops', () => {
    expect(segmentByRound([])).toEqual([]);
  });
});

describe('roundOfVisits', () => {
  it('takes the first visit that has a round', () => {
    expect(
      roundOfVisits([
        { round_id: null, round_name: null, round_colour: null },
        { round_id: 'a', round_name: 'Tuesday north', round_colour: '#7c3aed' },
      ]),
    ).toEqual({ ...A, leadWorkerId: null });
  });
  it('is null when none has one', () => {
    expect(roundOfVisits([{ round_id: null, round_name: null, round_colour: null }])).toBeNull();
  });
});
