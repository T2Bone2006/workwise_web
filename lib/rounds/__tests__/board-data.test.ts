import { beforeEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.fn();
const getTenantIdForCurrentUser = vi.fn();
const getTenantProducts = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createClient: (...a: unknown[]) => createClient(...a) }));
vi.mock('@/lib/data/tenant', () => ({
  getTenantIdForCurrentUser: (...a: unknown[]) => getTenantIdForCurrentUser(...a),
}));
vi.mock('@/lib/data/tenant-products', () => ({
  getTenantProducts: (...a: unknown[]) => getTenantProducts(...a),
}));

import { getVisitsForRange } from '@/lib/data/rounds/visits';
import { loadBoardWeeks } from '@/lib/actions/rounds/board';

/** A query builder that records what was asked and answers with `rows`. */
function fakeClient(rows: unknown[]) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return { client: { from: () => builder }, calls };
}

beforeEach(() => {
  createClient.mockReset();
  getTenantIdForCurrentUser.mockReset();
  getTenantProducts.mockReset();
});

describe('getVisitsForRange', () => {
  it('refuses a range that is backwards, too long, or not a date, without querying', async () => {
    for (const [from, to] of [
      ['2026-10-10', '2026-10-01'],
      ['2026-01-01', '2026-06-01'],
      ['nope', '2026-10-01'],
    ] as const) {
      const result = await getVisitsForRange('t1', from, to);
      expect(result.visits).toEqual([]);
      expect(result.error).toBeInstanceOf(Error);
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it('reads the tenant\'s visits between the two dates, date first', async () => {
    const { client, calls } = fakeClient([]);
    createClient.mockResolvedValue(client);

    const result = await getVisitsForRange('t1', '2026-10-05', '2026-10-18');

    expect(result.error).toBeNull();
    expect(calls.find((c) => c.method === 'eq')?.args).toEqual(['tenant_id', 't1']);
    expect(calls.find((c) => c.method === 'gte')?.args).toEqual(['scheduled_date', '2026-10-05']);
    expect(calls.find((c) => c.method === 'lte')?.args).toEqual(['scheduled_date', '2026-10-18']);
    expect(calls.filter((c) => c.method === 'order')[0]?.args[0]).toBe('scheduled_date');
  });
});

describe('loadBoardWeeks', () => {
  it('says Not authenticated for a logged-out user and never queries', async () => {
    getTenantIdForCurrentUser.mockResolvedValue(null);
    expect(await loadBoardWeeks({ from: '2026-10-05', weeks: 2 })).toEqual({
      success: false,
      error: 'Not authenticated',
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('refuses a business without Rounds', async () => {
    getTenantIdForCurrentUser.mockResolvedValue('t1');
    getTenantProducts.mockResolvedValue({ hasRounds: false });
    expect(await loadBoardWeeks({ from: '2026-10-05', weeks: 2 })).toEqual({
      success: false,
      error: 'Not available',
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('checks the date and the number of weeks', async () => {
    getTenantIdForCurrentUser.mockResolvedValue('t1');
    getTenantProducts.mockResolvedValue({ hasRounds: true });
    expect(await loadBoardWeeks({ from: 'x', weeks: 2 })).toMatchObject({ success: false });
    expect(await loadBoardWeeks({ from: '2026-10-05', weeks: 0 })).toMatchObject({ success: false });
    expect(await loadBoardWeeks({ from: '2026-10-05', weeks: 5 })).toMatchObject({ success: false });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('snaps to the Monday and loads that run, using the signed-in tenant', async () => {
    getTenantIdForCurrentUser.mockResolvedValue('t1');
    getTenantProducts.mockResolvedValue({ hasRounds: true });
    const { client, calls } = fakeClient([]);
    createClient.mockResolvedValue(client);

    const result = await loadBoardWeeks({ from: '2026-10-08', weeks: 2 });

    expect(result).toEqual({ success: true, visits: [], from: '2026-10-05', to: '2026-10-18' });
    expect(calls.find((c) => c.method === 'eq')?.args).toEqual(['tenant_id', 't1']);
  });
});
