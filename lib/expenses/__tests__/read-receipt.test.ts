import { afterEach, describe, expect, it, vi } from 'vitest';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  needsEscalation,
  ReceiptReadSchema,
  toDraftFields,
  type ReceiptRead,
} from '@/lib/expenses/receipt-schema';
import {
  scanReceiptCore,
  type ReceiptCall,
  type ReceiptReader,
  type ScanInput,
} from '@/lib/expenses/read-receipt';

// The models are settings. These tests choose them, so they do not depend on the shipped default.
const models = vi.hoisted(() => ({ first: 'claude-haiku-4-5', second: 'claude-sonnet-5-5' }));
vi.mock('@/lib/ai/model', () => ({
  get RECEIPT_AI_MODEL() {
    return models.first;
  },
  get RECEIPT_ESCALATION_MODEL() {
    return models.second;
  },
  supportsEffort: () => false,
}));

vi.mock('@/lib/services/ai-interaction-log', () => ({
  logStructuredAiInteraction: vi.fn(async () => {}),
}));

const TODAY = '2026-10-01';

function read(overrides: Partial<ReceiptRead> = {}): ReceiptRead {
  return {
    is_receipt: true,
    merchant: 'Screwfix',
    date: '2026-09-28',
    total: 24.99,
    vat: 4.17,
    line_items: [{ description: 'Squeegee rubbers', amount: 24.99 }],
    category: 'supplies',
    confidence: 0.92,
    ...overrides,
  };
}

describe('ReceiptReadSchema', () => {
  it('builds a structured-output format', () => {
    expect(() => zodOutputFormat(ReceiptReadSchema)).not.toThrow();
  });
});

describe('needsEscalation (T5)', () => {
  it('leaves a clean read alone', () => {
    expect(needsEscalation(read())).toBe(false);
  });
  it('escalates low confidence', () => {
    expect(needsEscalation(read({ confidence: 0.69 }))).toBe(true);
    expect(needsEscalation(read({ confidence: 0.7 }))).toBe(false);
  });
  it('escalates a missing total', () => {
    expect(needsEscalation(read({ total: null, line_items: [] }))).toBe(true);
  });
  it('escalates a missing or invalid date', () => {
    expect(needsEscalation(read({ date: '' }))).toBe(true);
    expect(needsEscalation(read({ date: '2026-13-40' }))).toBe(true);
  });
  it('escalates line items that do not add up (more than 2p out)', () => {
    expect(needsEscalation(read({ total: 30, line_items: [{ description: 'a', amount: 24.99 }] }))).toBe(true);
    expect(needsEscalation(read({ total: 25.01, line_items: [{ description: 'a', amount: 24.99 }] }))).toBe(false);
  });
  it('does not escalate something that is not a receipt', () => {
    expect(needsEscalation(read({ is_receipt: false, confidence: 0.1, total: null, date: '' }))).toBe(false);
  });
});

describe('toDraftFields', () => {
  it('keeps a good read, rounded to 2dp', () => {
    expect(toDraftFields(read({ total: 24.994, vat: 4.166 }), TODAY)).toEqual({
      spent_on: '2026-09-28',
      merchant: 'Screwfix',
      amount: 24.99,
      vat_amount: 4.17,
      category: 'supplies',
      ai_confidence: 0.92,
    });
  });
  it('drops a future date and one over two years old', () => {
    expect(toDraftFields(read({ date: '2026-10-02' }), TODAY).spent_on).toBeNull();
    expect(toDraftFields(read({ date: '2024-09-01' }), TODAY).spent_on).toBeNull();
    expect(toDraftFields(read({ date: '2026-10-01' }), TODAY).spent_on).toBe('2026-10-01');
  });
  it('drops a negative, zero or silly total (and its VAT)', () => {
    for (const total of [-5, 0, 100001]) {
      const f = toDraftFields(read({ total }), TODAY);
      expect(f.amount).toBeNull();
      expect(f.vat_amount).toBeNull();
    }
  });
  it('drops VAT bigger than the total or below zero', () => {
    expect(toDraftFields(read({ total: 10, vat: 12 }), TODAY).vat_amount).toBeNull();
    expect(toDraftFields(read({ vat: -1 }), TODAY).vat_amount).toBeNull();
  });
  it('truncates a long merchant and blanks an empty one', () => {
    expect(toDraftFields(read({ merchant: 'x'.repeat(200) }), TODAY).merchant).toHaveLength(120);
    expect(toDraftFields(read({ merchant: '  ' }), TODAY).merchant).toBeNull();
  });
  it('never guesses a category', () => {
    expect(toDraftFields(read({ category: null }), TODAY).category).toBeNull();
  });
});

// --- a tiny in-memory stand-in for the service-role client ---

type Row = Record<string, unknown>;
type Fake = {
  admin: SupabaseClient;
  rows: Row[];
  uploads: string[];
  removed: string[];
  updates: Array<{ values: Row; filters: Array<[string, unknown]> }>;
  opts: {
    uploadError?: boolean;
    insertError?: { code: string } | null;
    countError?: boolean;
    count?: number;
    raceWinner?: Row;
  };
};

function fakeAdmin(): Fake {
  const f = { rows: [] as Row[], uploads: [] as string[], removed: [] as string[], updates: [] as Fake['updates'], opts: {} as Fake['opts'] };

  function builder(table: string) {
    let mode: 'select' | 'update' | 'insert' = 'select';
    let head = false;
    let values: Row = {};
    const filters: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {};
    const matches = (r: Row) => filters.every(([k, v]) => r[k] === v);
    const run = () => {
      if (mode === 'insert') {
        if (f.opts.raceWinner) {
          f.rows.push(f.opts.raceWinner);
          return { error: { code: '23505' } };
        }
        if (f.opts.insertError) return { error: f.opts.insertError };
        f.rows.push(values);
        return { error: null };
      }
      if (mode === 'update') {
        f.updates.push({ values, filters: [...filters] });
        for (const r of f.rows.filter(matches)) Object.assign(r, values);
        return { error: null };
      }
      if (head) {
        return f.opts.countError
          ? { count: null, error: { message: 'x' } }
          : { count: f.opts.count ?? 0, error: null };
      }
      return { data: f.rows.find(matches) ?? null, error: null };
    };
    b.select = (_cols?: string, o?: { head?: boolean }) => { head = !!o?.head; return b; };
    b.insert = (v: Row) => { mode = 'insert'; values = v; return b; };
    b.update = (v: Row) => { mode = 'update'; values = v; return b; };
    b.eq = (k: string, v: unknown) => { filters.push([k, v]); return b; };
    b.gte = () => b;
    b.maybeSingle = async () => run();
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve);
    void table;
    return b;
  }

  const admin = {
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        upload: async (path: string) => {
          if (f.opts.uploadError) return { error: { message: 'x' } };
          f.uploads.push(path);
          return { error: null };
        },
        remove: async (paths: string[]) => { f.removed.push(...paths); return { error: null }; },
      }),
    },
  } as unknown as SupabaseClient;

  return { ...f, admin } as Fake;
}

// `fakeAdmin` spreads arrays by reference, so the returned arrays are the live ones.

const input = (overrides: Partial<ScanInput> = {}): ScanInput => ({
  tenantId: 'tenant-1',
  userId: 'user-1',
  clientMutationId: 'abcdef12-3456',
  file: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' },
  ...overrides,
});

const call = (model: string, r: ReceiptRead): ReceiptCall => ({
  read: r, model, tokensInput: 100, tokensOutput: 50, latencyMs: 10,
});

describe('scanReceiptCore', () => {
  afterEach(() => {
    models.first = 'claude-haiku-4-5';
    models.second = 'claude-sonnet-5-5';
  });

  it('refuses the wrong type and a file that is too big before storing anything', async () => {
    const fake = fakeAdmin();
    const reader = vi.fn<ReceiptReader>();
    expect(await scanReceiptCore(fake.admin, input({ file: { bytes: new Uint8Array(1), mime: 'image/heic' } }), reader))
      .toEqual({ ok: false, error: 'wrong_type' });
    expect(await scanReceiptCore(fake.admin, input({ file: { bytes: new Uint8Array(8 * 1024 * 1024 + 1), mime: 'image/png' } }), reader))
      .toEqual({ ok: false, error: 'too_big' });
    expect(fake.uploads).toHaveLength(0);
    expect(reader).not.toHaveBeenCalled();
  });

  it('stores the photo, makes a draft and fills it in, never confirming', async () => {
    const fake = fakeAdmin();
    const reader = vi.fn<ReceiptReader>(async (model) => call(model, read()));
    const result = await scanReceiptCore(fake.admin, input(), reader);
    expect(result).toMatchObject({ ok: true, status: 'draft', read: 'read', replay: false });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]).toMatch(/^tenant-1\/[0-9a-f-]{36}\.jpg$/);
    const row = fake.rows[0];
    expect(row).toMatchObject({ status: 'draft', source: 'receipt_scan', amount: 24.99, category: 'supplies', merchant: 'Screwfix' });
    expect(row.status).toBe('draft');
  });

  it('returns the existing row on a replay, with no photo and no AI call', async () => {
    const fake = fakeAdmin();
    fake.rows.push({ id: 'exp-1', tenant_id: 'tenant-1', client_mutation_id: 'abcdef12-3456', status: 'draft', ai_extracted: read() });
    const reader = vi.fn<ReceiptReader>();
    const result = await scanReceiptCore(fake.admin, input(), reader);
    expect(result).toEqual({ ok: true, expenseId: 'exp-1', status: 'draft', read: 'read', replay: true });
    expect(reader).not.toHaveBeenCalled();
    expect(fake.uploads).toHaveLength(0);
  });

  it('on a lost race deletes only its own photo and returns the winner', async () => {
    const fake = fakeAdmin();
    fake.opts.raceWinner = { id: 'winner-id', tenant_id: 'tenant-1', client_mutation_id: 'abcdef12-3456', status: 'draft', ai_extracted: null };
    const reader = vi.fn<ReceiptReader>();
    const result = await scanReceiptCore(fake.admin, input(), reader);
    expect(result).toEqual({ ok: true, expenseId: 'winner-id', status: 'draft', read: 'unreadable', replay: true });
    expect(fake.removed).toEqual(fake.uploads);
    expect(fake.removed[0]).not.toContain('winner-id');
    expect(reader).not.toHaveBeenCalled();
  });

  it('removes the photo when the insert fails for another reason', async () => {
    const fake = fakeAdmin();
    fake.opts.insertError = { code: '42501' };
    expect(await scanReceiptCore(fake.admin, input(), vi.fn())).toEqual({ ok: false, error: 'save_failed' });
    expect(fake.removed).toEqual(fake.uploads);
  });

  it('stores nothing when the upload fails', async () => {
    const fake = fakeAdmin();
    fake.opts.uploadError = true;
    expect(await scanReceiptCore(fake.admin, input(), vi.fn())).toEqual({ ok: false, error: 'storage_failed' });
    expect(fake.rows).toHaveLength(0);
  });

  it('stops at the daily limit, and fails safe when it cannot count', async () => {
    const limited = fakeAdmin();
    limited.opts.count = 200;
    expect(await scanReceiptCore(limited.admin, input(), vi.fn())).toEqual({ ok: false, error: 'daily_limit' });
    expect(limited.uploads).toHaveLength(0);

    const broken = fakeAdmin();
    broken.opts.countError = true;
    expect(await scanReceiptCore(broken.admin, input(), vi.fn())).toEqual({ ok: false, error: 'save_failed' });
    expect(broken.uploads).toHaveLength(0);
  });

  it('keeps a blank draft with the photo when the AI throws or cannot be read', async () => {
    const thrown = fakeAdmin();
    const result = await scanReceiptCore(thrown.admin, input(), async () => { throw new Error('boom'); });
    expect(result).toMatchObject({ ok: true, status: 'draft', read: 'unreadable', replay: false });
    expect(thrown.rows[0]).toMatchObject({ status: 'draft', receipt_path: thrown.uploads[0] });
    expect(thrown.rows[0].amount).toBeUndefined();

    const nothing = fakeAdmin();
    expect(await scanReceiptCore(nothing.admin, input(), async () => null))
      .toMatchObject({ read: 'unreadable' });
  });

  it('keeps a not-a-receipt draft blank', async () => {
    const fake = fakeAdmin();
    const result = await scanReceiptCore(fake.admin, input(), async (m) => call(m, read({ is_receipt: false, total: null })));
    expect(result).toMatchObject({ ok: true, read: 'not_a_receipt' });
    expect(fake.rows[0].amount).toBeUndefined();
    expect(fake.rows[0].status).toBe('draft');
  });

  it('asks the stronger model once when the first read is unsure, and keeps its answer', async () => {
    const fake = fakeAdmin();
    const reader = vi.fn<ReceiptReader>(async (model) =>
      model === 'claude-haiku-4-5'
        ? call(model, read({ confidence: 0.4, total: null, line_items: [] }))
        : call(model, read({ total: 31.5, line_items: [] })));
    await scanReceiptCore(fake.admin, input(), reader);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(fake.rows[0]).toMatchObject({ amount: 31.5, ai_model: 'claude-sonnet-5-5' });
  });

  it('keeps the first read when the stronger model fails, and never calls a third time', async () => {
    const fake = fakeAdmin();
    const unsure = read({ confidence: 0.5 });
    const reader = vi.fn<ReceiptReader>(async (model) =>
      model === 'claude-haiku-4-5' ? call(model, unsure) : null);
    const result = await scanReceiptCore(fake.admin, input(), reader);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ read: 'read' });
    expect(fake.rows[0]).toMatchObject({ amount: 24.99, ai_model: 'claude-haiku-4-5' });
  });

  it('with the same model for both (the shipped default) an unsure read is not repeated', async () => {
    models.first = 'claude-sonnet-5-5';
    models.second = 'claude-sonnet-5-5';
    const fake = fakeAdmin();
    const reader = vi.fn<ReceiptReader>(async (model) => call(model, read({ confidence: 0.3, total: null, line_items: [] })));
    const result = await scanReceiptCore(fake.admin, input(), reader);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledWith('claude-sonnet-5-5', expect.anything());
    expect(result).toMatchObject({ ok: true, read: 'read' });
  });

  it('only ever fills a row that is still a draft', async () => {
    const fake = fakeAdmin();
    await scanReceiptCore(fake.admin, input(), async (m) => call(m, read()));
    const update = fake.updates[0];
    expect(update.filters).toContainEqual(['status', 'draft']);
    expect(update.values).not.toHaveProperty('status');
    expect(update.values).not.toHaveProperty('confirmed_at');
  });

  it('skips the AI for an image over 5 MB but keeps the photo', async () => {
    const fake = fakeAdmin();
    const reader = vi.fn<ReceiptReader>();
    const result = await scanReceiptCore(
      fake.admin,
      input({ file: { bytes: new Uint8Array(6 * 1024 * 1024), mime: 'image/jpeg' } }),
      reader,
    );
    expect(result).toMatchObject({ ok: true, read: 'unreadable' });
    expect(reader).not.toHaveBeenCalled();
    expect(fake.uploads).toHaveLength(1);
  });
});
