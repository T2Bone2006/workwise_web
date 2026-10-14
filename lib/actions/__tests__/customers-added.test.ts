import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { markCheckedCore } from '@/lib/team/added-by-core';

/** A query builder that records every call and answers with the rows we hand it. */
function fakeDb(rows: Array<{ id: string }>, error: { message: string } | null = null) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const name of ['update', 'eq', 'not', 'is']) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return builder;
    };
  }
  builder.select = (...args: unknown[]) => {
    calls.push(['select', ...args]);
    return Promise.resolve({ data: error ? null : rows, error });
  };
  const from = vi.fn(() => builder);
  return { db: { from } as unknown as SupabaseClient, calls, from };
}

describe('markCheckedCore', () => {
  it('checks only unchecked customers a member of staff added, in this business, and changes only the checked mark', async () => {
    const { db, calls, from } = fakeDb([{ id: 'c1' }, { id: 'c2' }]);
    const result = await markCheckedCore(db, { tenantId: 't1', now: new Date('2026-10-12T10:00:00Z') });
    expect(result).toEqual({ ok: true, changed: 2 });
    expect(from).toHaveBeenCalledWith('customers');
    expect(calls).toContainEqual(['update', { added_checked_at: '2026-10-12T10:00:00.000Z' }]);
    expect(calls).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(calls).toContainEqual(['not', 'added_by_worker_id', 'is', null]);
    expect(calls).toContainEqual(['is', 'added_checked_at', null]);
  });

  it('narrows to one customer for "Looks fine"', async () => {
    const { db, calls } = fakeDb([{ id: 'c1' }]);
    const result = await markCheckedCore(db, { tenantId: 't1', customerId: 'c1' });
    expect(result).toEqual({ ok: true, changed: 1 });
    expect(calls).toContainEqual(['eq', 'id', 'c1']);
  });

  it('changes 0 when there is nothing left to check (run twice)', async () => {
    const { db } = fakeDb([]);
    expect(await markCheckedCore(db, { tenantId: 't1' })).toEqual({ ok: true, changed: 0 });
  });

  it('says so plainly when the database refuses', async () => {
    const { db } = fakeDb([], { message: 'boom' });
    const result = await markCheckedCore(db, { tenantId: 't1' });
    expect(result).toEqual({ ok: false, error: 'Could not mark that as checked. Try again.' });
  });
});
