import { describe, expect, it } from 'vitest';
import {
  buildFieldGroupValueFilter,
  decodeFieldGroupRef,
  encodeFieldGroupRef,
  groupForHeader,
  normaliseFieldGroups,
  parseFieldGroups,
  ungroupedHeaders,
  valueForFieldGroup,
  type FieldGroup,
} from '@/lib/jobs/field-groups';

const wo: FieldGroup = { id: 'g1', name: 'Warrant Officer', aliases: ['Warrant Officer', 'W/O', 'B/R Name'] };

describe('refs', () => {
  it('round-trips a group id', () => {
    expect(decodeFieldGroupRef(encodeFieldGroupRef('abc'))).toBe('abc');
  });
  it('ignores other filter fields', () => {
    expect(decodeFieldGroupRef('sf:Lock Type')).toBeNull();
    expect(decodeFieldGroupRef('status')).toBeNull();
    expect(decodeFieldGroupRef('fg:')).toBeNull();
  });
});

describe('parseFieldGroups', () => {
  it('drops malformed entries instead of throwing', () => {
    expect(parseFieldGroups(null)).toEqual([]);
    expect(parseFieldGroups('x')).toEqual([]);
    expect(
      parseFieldGroups([
        wo,
        { id: 'g1', name: 'Duplicate id', aliases: [] },
        { id: '', name: 'No id', aliases: [] },
        { id: 'g2', name: '  ', aliases: [] },
        { id: 'g3', name: 'Bad aliases', aliases: ['ok', 5, ''] },
        7,
      ])
    ).toEqual([wo, { id: 'g3', name: 'Bad aliases', aliases: ['ok'] }]);
  });
});

describe('valueForFieldGroup', () => {
  it('reads whichever alias the job carries', () => {
    expect(valueForFieldGroup(wo, { 'W/O': 'Smith', Other: 'x' })).toBe('Smith');
    expect(valueForFieldGroup(wo, { 'B/R Name': ' Jones ' })).toBe('Jones');
  });
  it('prefers the earlier alias when a job somehow has two', () => {
    expect(valueForFieldGroup(wo, { 'W/O': 'second', 'Warrant Officer': 'first' })).toBe('first');
  });
  it('is empty when the job has none of them', () => {
    expect(valueForFieldGroup(wo, { Other: 'x' })).toBe('');
    expect(valueForFieldGroup(wo, null)).toBe('');
  });
});

describe('groupForHeader / ungroupedHeaders', () => {
  it('finds the owning group', () => {
    expect(groupForHeader([wo], 'W/O')?.id).toBe('g1');
    expect(groupForHeader([wo], 'Lock Type')).toBeNull();
  });
  it('lists headers nobody has grouped, sorted', () => {
    expect(ungroupedHeaders(['W/O', 'zebra', 'Apple', 'B/R Name'], [wo])).toEqual(['Apple', 'zebra']);
  });
});

describe('normaliseFieldGroups', () => {
  let n = 0;
  const newId = () => `new${++n}`;

  it('gives new groups ids and tidies names and headers', () => {
    const r = normaliseFieldGroups(
      [{ name: '  Warrant   Officer ', aliases: [' W/O ', 'W/O', '', 'Warrant Officer'] }],
      newId
    );
    expect(r.ok && r.groups[0]).toMatchObject({ name: 'Warrant Officer', aliases: ['W/O', 'Warrant Officer'] });
    expect(r.ok && r.groups[0].id).toMatch(/^new/);
  });

  it('keeps existing ids so a rename breaks nothing', () => {
    const r = normaliseFieldGroups([{ id: 'g1', name: 'WO', aliases: ['W/O'] }], newId);
    expect(r.ok && r.groups[0].id).toBe('g1');
  });

  it('refuses a column that is in two fields', () => {
    const r = normaliseFieldGroups(
      [
        { id: 'a', name: 'A', aliases: ['W/O'] },
        { id: 'b', name: 'B', aliases: ['W/O'] },
      ],
      newId
    );
    expect(r).toEqual({ ok: false, error: '"W/O" is already in "A". A column can only be in one field.' });
  });

  it('refuses empty and duplicate names', () => {
    expect(normaliseFieldGroups([{ name: ' ', aliases: [] }], newId).ok).toBe(false);
    expect(
      normaliseFieldGroups(
        [
          { name: 'Lock', aliases: [] },
          { name: 'lock', aliases: [] },
        ],
        newId
      ).ok
    ).toBe(false);
  });
});

describe('buildFieldGroupValueFilter', () => {
  it('makes one quoted containment test per header', () => {
    expect(buildFieldGroupValueFilter(['W/O', 'B/R Name'], 'Smith')).toBe(
      'source_fields.cs."{\\"W/O\\":\\"Smith\\"}",source_fields.cs."{\\"B/R Name\\":\\"Smith\\"}"'
    );
  });
  it('keeps commas, brackets and quotes in a value from splitting the filter', () => {
    const f = buildFieldGroupValueFilter(['W/O'], 'Smith, J (Sgt) "Bob"');
    // A single quoted token: the only unescaped quotes are the two around it.
    expect(f.startsWith('source_fields.cs."')).toBe(true);
    expect(f.endsWith('"')).toBe(true);
    expect(f).toContain('\\\\\\"Bob\\\\\\"');
  });
});
