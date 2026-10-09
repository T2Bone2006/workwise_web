import { describe, expect, it } from 'vitest';
import { applyChunk, emptyProgress, summaryLine, type ChunkOutcome } from '@/lib/workers/bulk-summary';
import { computeAllowance, noticeForBatch } from '@/lib/billing/pro-allowance';

const ok = (line: number, outcome: 'invited' | 'added'): ChunkOutcome => ({ line, outcome, workerId: `w${line}` });
const bad = (line: number): ChunkOutcome => ({ line, outcome: 'failed', error: 'nope' });

describe('applyChunk', () => {
  it('counts each outcome and keeps the failures', () => {
    let p = emptyProgress(5);
    p = applyChunk(p, [ok(1, 'invited'), ok(2, 'invited'), ok(3, 'added')]);
    p = applyChunk(p, [bad(4), ok(5, 'invited')]);
    expect(p).toMatchObject({ total: 5, done: 5, invited: 3, addedNoInvite: 1 });
    expect(p.failed.map((f) => f.line)).toEqual([4]);
  });

  it('does not change the progress it was given', () => {
    const p = emptyProgress(2);
    applyChunk(p, [bad(1)]);
    expect(p.failed).toEqual([]);
    expect(p.done).toBe(0);
  });
});

describe('summaryLine', () => {
  it('says everyone was invited', () => {
    expect(summaryLine(applyChunk(emptyProgress(3), [ok(1, 'invited'), ok(2, 'invited'), ok(3, 'invited')]))).toBe(
      '3 workers added: 3 invited by email.',
    );
  });

  it('mixes invited, no-invite and failures', () => {
    const p = applyChunk(emptyProgress(40), [
      ...Array.from({ length: 36 }, (_, i) => ok(i + 1, 'invited')),
      ok(37, 'added'),
      ok(38, 'added'),
      bad(39),
    ]);
    expect(summaryLine(p)).toBe("38 workers added: 36 invited by email, 2 added without an invite. 1 couldn't be added.");
  });

  it('uses singular and plural', () => {
    expect(summaryLine(applyChunk(emptyProgress(1), [ok(1, 'added')]))).toBe('1 worker added: 1 added without an invite.');
    expect(summaryLine(applyChunk(emptyProgress(3), [ok(1, 'invited'), bad(2), bad(3)]))).toBe(
      "1 worker added: 1 invited by email. 2 couldn't be added.",
    );
  });

  it('handles nobody added', () => {
    expect(summaryLine(emptyProgress(0))).toBe('Nobody was added.');
    expect(summaryLine(applyChunk(emptyProgress(2), [bad(1), bad(2)]))).toBe("Nobody was added. 2 workers couldn't be added.");
  });
});

describe('the live cost line uses the same maths as the server', () => {
  const starter = (used: number) => computeAllowance({ tier: 'starter', source: 'stripe', includedOverride: null, used });
  it.each([
    [starter(0), 10, null],
    [starter(10), 1, 1],
    [starter(8), 40, 38],
    [starter(12), 3, 3],
  ])('batch of %#', (allowance, adding, expectedNew) => {
    expect(noticeForBatch(allowance, adding)?.newExtras ?? null).toBe(expectedNew);
  });
});
