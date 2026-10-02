import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addExpenseCore,
  deleteExpenseCore,
  receiptSignedUrl,
  saveExpenseCore,
} from '@/lib/expenses/expenses-core';
import { addExpenseSchema, saveExpenseSchema } from '@/lib/validations/expenses';

vi.mock('@/lib/services/ai-interaction-log', () => ({ logStructuredAiInteraction: vi.fn() }));

type Row = Record<string, unknown>;

/** In-memory stand-in: one table, plus a storage bucket that records removals. */
function fakeDb(rows: Row[] = []) {
  const state = {
    rows,
    log: [] as string[],
    insertError: null as { code: string } | null,
    deleteError: null as { code: string } | null,
    removeError: false,
    removed: [] as string[],
    signed: [] as Array<[string, number]>,
  };
  function builder() {
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let values: Row = {};
    const filters: Array<[string, unknown]> = [];
    let returning = false;
    const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
    const run = () => {
      if (mode === 'insert') {
        if (state.insertError) return { error: state.insertError };
        state.rows.push(values);
        return { error: null };
      }
      if (mode === 'update') {
        const hit = state.rows.filter(match);
        hit.forEach((r) => Object.assign(r, values));
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      if (mode === 'delete') {
        state.log.push('row-delete');
        if (state.deleteError) return { data: null, error: state.deleteError };
        const hit = state.rows.filter(match);
        state.rows = state.rows.filter((r) => !match(r));
        return { data: returning ? hit : null, error: null };
      }
      return { data: state.rows.find(match) ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => {
        returning = true;
        return b;
      },
      insert: (v: Row) => {
        mode = 'insert';
        values = v;
        return b;
      },
      update: (v: Row) => {
        mode = 'update';
        values = v;
        return b;
      },
      delete: () => {
        mode = 'delete';
        return b;
      },
      eq: (k: string, v: unknown) => {
        filters.push([k, v]);
        return b;
      },
      maybeSingle: async () => run(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return b;
  }
  const client = {
    from: () => builder(),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          state.log.push('photo-remove');
          state.removed.push(...paths);
          return { error: state.removeError ? { message: 'x' } : null };
        },
        createSignedUrl: async (path: string, seconds: number) => {
          state.signed.push([path, seconds]);
          return { data: { signedUrl: `https://signed/${path}` }, error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, state };
}

const valid = {
  spentOn: '2026-09-20',
  merchant: 'Shell',
  category: 'vehicle' as const,
  amount: 60,
  vatAmount: 10,
  note: '',
  clientMutationId: 'abcdef12-3456',
};

describe('expense validation', () => {
  it('accepts a good expense', () => {
    expect(addExpenseSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses missing category, zero amount, future date, VAT over the total', () => {
    const msg = (o: object) => {
      const r = addExpenseSchema.safeParse({ ...valid, ...o });
      return r.success ? null : r.error.issues[0].message;
    };
    expect(msg({ category: 'fuel' })).toBe('Pick a category');
    expect(msg({ amount: 0 })).toBe('Enter the amount');
    expect(msg({ spentOn: '2999-01-01' })).toBe("The date can't be in the future");
    expect(msg({ vatAmount: 61 })).toBe("VAT can't be more than the total");
  });

  it('needs a uuid to save', () => {
    expect(saveExpenseSchema.safeParse({ ...valid, expenseId: 'nope' }).success).toBe(false);
  });
});

describe('addExpenseCore', () => {
  it('inserts a confirmed manual expense', async () => {
    const { client, state } = fakeDb();
    const values = addExpenseSchema.parse(valid);
    const result = await addExpenseCore(client, { tenantId: 't1', userId: 'u1', values });
    expect(result).toMatchObject({ ok: true });
    expect(state.rows[0]).toMatchObject({
      tenant_id: 't1',
      status: 'confirmed',
      source: 'manual',
      category: 'vehicle',
      amount: 60,
      vat_amount: 10,
      merchant: 'Shell',
      note: null,
      client_mutation_id: 'abcdef12-3456',
      created_by_user_id: 'u1',
    });
    expect(state.rows[0].confirmed_at).toBeTruthy();
  });

  it('returns the same id on a replay', async () => {
    const { client, state } = fakeDb([
      { id: 'existing', tenant_id: 't1', client_mutation_id: 'abcdef12-3456' },
    ]);
    state.insertError = { code: '23505' };
    const result = await addExpenseCore(client, {
      tenantId: 't1',
      userId: null,
      values: addExpenseSchema.parse(valid),
    });
    expect(result).toEqual({ ok: true, expenseId: 'existing', replay: true });
  });

  it('reports other failures plainly', async () => {
    const { client, state } = fakeDb();
    state.insertError = { code: '42501' };
    expect(
      await addExpenseCore(client, {
        tenantId: 't1',
        userId: null,
        values: addExpenseSchema.parse(valid),
      }),
    ).toEqual({ ok: false, error: "Couldn't save that. Try again." });
  });
});

describe('saveExpenseCore', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const values = saveExpenseSchema.parse({ ...valid, expenseId: id });

  it('confirms a draft and stamps confirmed_at', async () => {
    const { client, state } = fakeDb([{ id, tenant_id: 't1', status: 'draft', confirmed_at: null }]);
    expect(await saveExpenseCore(client, { tenantId: 't1', values })).toEqual({
      ok: true,
      expenseId: id,
    });
    expect(state.rows[0]).toMatchObject({ status: 'confirmed', amount: 60, category: 'vehicle' });
    expect(state.rows[0].confirmed_at).toBeTruthy();
  });

  it('keeps the original confirmed_at when editing, and saving twice is harmless', async () => {
    const { client, state } = fakeDb([
      { id, tenant_id: 't1', status: 'confirmed', confirmed_at: '2026-01-01T00:00:00.000Z' },
    ]);
    await saveExpenseCore(client, { tenantId: 't1', values });
    await saveExpenseCore(client, { tenantId: 't1', values });
    expect(state.rows[0].confirmed_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('says so when the expense is gone or belongs to someone else', async () => {
    const { client } = fakeDb([{ id, tenant_id: 'other', status: 'draft' }]);
    expect(await saveExpenseCore(client, { tenantId: 't1', values })).toEqual({
      ok: false,
      error: 'This expense no longer exists.',
    });
  });
});

describe('deleteExpenseCore', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  it('removes the row before the photo', async () => {
    const { client, state } = fakeDb([{ id, tenant_id: 't1', receipt_path: 't1/a.jpg' }]);
    const result = await deleteExpenseCore(client, client, { tenantId: 't1', expenseId: id });
    expect(result).toEqual({ ok: true, expenseId: id });
    expect(state.log).toEqual(['row-delete', 'photo-remove']);
    expect(state.removed).toEqual(['t1/a.jpg']);
  });

  it('is still ok when only the photo delete fails', async () => {
    const { client, state } = fakeDb([{ id, tenant_id: 't1', receipt_path: 't1/a.jpg' }]);
    state.removeError = true;
    expect(await deleteExpenseCore(client, client, { tenantId: 't1', expenseId: id })).toMatchObject({
      ok: true,
    });
  });

  it('leaves the photo alone when the row delete fails', async () => {
    const { client, state } = fakeDb([{ id, tenant_id: 't1', receipt_path: 't1/a.jpg' }]);
    state.deleteError = { code: '42501' };
    expect(await deleteExpenseCore(client, client, { tenantId: 't1', expenseId: id })).toMatchObject({
      ok: false,
    });
    expect(state.removed).toEqual([]);
  });

  it('says so when already gone, and skips the photo when there is none', async () => {
    const { client, state } = fakeDb([{ id, tenant_id: 't1', receipt_path: null }]);
    expect((await deleteExpenseCore(client, client, { tenantId: 't1', expenseId: id })).ok).toBe(true);
    expect(state.removed).toEqual([]);
    expect(await deleteExpenseCore(client, client, { tenantId: 't1', expenseId: id })).toEqual({
      ok: false,
      error: 'This expense no longer exists.',
    });
  });
});

describe('receiptSignedUrl', () => {
  it('signs for 300 seconds, only for this business and only when there is a photo', async () => {
    const { client, state } = fakeDb([
      { id: 'a', tenant_id: 't1', receipt_path: 't1/a.jpg' },
      { id: 'b', tenant_id: 't1', receipt_path: null },
      { id: 'c', tenant_id: 'other', receipt_path: 'other/c.jpg' },
    ]);
    expect(await receiptSignedUrl(client, { tenantId: 't1', expenseId: 'a' })).toBe(
      'https://signed/t1/a.jpg',
    );
    expect(state.signed).toEqual([['t1/a.jpg', 300]]);
    expect(await receiptSignedUrl(client, { tenantId: 't1', expenseId: 'b' })).toBeNull();
    expect(await receiptSignedUrl(client, { tenantId: 't1', expenseId: 'c' })).toBeNull();
  });
});

describe('actions: who may call them', () => {
  beforeEach(() => vi.resetModules());

  async function loadActions(opts: { hasRounds: boolean; role: 'admin' | 'worker' }) {
    vi.doMock('next/cache', () => ({ revalidatePath: vi.fn() }));
    vi.doMock('@/lib/data/tenant', () => ({ getTenantIdForCurrentUser: async () => 't1' }));
    vi.doMock('@/lib/data/tenant-products', () => ({
      getTenantProducts: async () => ({ hasRounds: opts.hasRounds }),
    }));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: opts.role } }) }) }),
        }),
      }),
    }));
    return import('@/lib/actions/expenses');
  }

  it('gives a worker the owner message', async () => {
    const actions = await loadActions({ hasRounds: true, role: 'worker' });
    expect(await actions.addExpense(valid)).toEqual({
      success: false,
      error: 'Only the account owner can do this.',
    });
    expect(await actions.deleteExpense({ expenseId: '11111111-1111-4111-8111-111111111111' })).toEqual({
      success: false,
      error: 'Only the account owner can do this.',
    });
  });

  it('keeps Pro out', async () => {
    const actions = await loadActions({ hasRounds: false, role: 'admin' });
    expect(await actions.addExpense(valid)).toEqual({
      success: false,
      error: 'Expenses are part of Rounds.',
    });
  });

  it('refuses HEIC and oversized files with the exact messages', async () => {
    const actions = await loadActions({ hasRounds: true, role: 'admin' });
    const heic = new FormData();
    heic.set('file', new File([new Uint8Array(10)], 'IMG_1.heic', { type: 'image/heic' }));
    heic.set('clientMutationId', 'abcdef12-3456');
    expect(await actions.scanReceipt(heic)).toEqual({
      success: false,
      error:
        "That file type isn't supported. Use a photo (JPG or PNG) or a PDF. Save it as a JPG and try again.",
    });
    const big = new FormData();
    big.set('file', new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'a.jpg', { type: 'image/jpeg' }));
    big.set('clientMutationId', 'abcdef12-3456');
    expect(await actions.scanReceipt(big)).toEqual({
      success: false,
      error: 'That file is too big (8 MB max).',
    });
  });
});
