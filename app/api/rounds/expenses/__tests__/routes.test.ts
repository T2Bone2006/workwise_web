import { beforeEach, describe, expect, it, vi } from 'vitest';

const createClientFromBearer = vi.fn();
const resolveTenantForUser = vi.fn();
const tenantHasRounds = vi.fn();
const isTenantAdmin = vi.fn();
const addExpenseCore = vi.fn();
const saveExpenseCore = vi.fn();
const deleteExpenseCore = vi.fn();
const receiptSignedUrl = vi.fn();
const scanReceiptCore = vi.fn();
const listDraftExpenses = vi.fn();
const listExpenses = vi.fn();
const getExpense = vi.fn();
const loadBooksSummary = vi.fn();

const SUPABASE = { tag: 'user-client' };
const ADMIN = { tag: 'admin' };

vi.mock('@/lib/auth/bearer', () => ({
  createClientFromBearer: (r: Request) => createClientFromBearer(r),
  resolveTenantForUser: (...a: unknown[]) => resolveTenantForUser(...a),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ADMIN }));
vi.mock('@/lib/messaging/rounds-tenants', () => ({
  tenantHasRounds: (...a: unknown[]) => tenantHasRounds(...a),
}));
vi.mock('@/lib/stripe/connect', () => ({
  isTenantAdmin: (...a: unknown[]) => isTenantAdmin(...a),
}));
vi.mock('@/lib/expenses/expenses-core', () => ({
  addExpenseCore: (...a: unknown[]) => addExpenseCore(...a),
  saveExpenseCore: (...a: unknown[]) => saveExpenseCore(...a),
  deleteExpenseCore: (...a: unknown[]) => deleteExpenseCore(...a),
  receiptSignedUrl: (...a: unknown[]) => receiptSignedUrl(...a),
}));
vi.mock('@/lib/expenses/read-receipt', () => ({
  scanReceiptCore: (...a: unknown[]) => scanReceiptCore(...a),
}));
vi.mock('@/lib/data/expenses', () => ({
  listDraftExpenses: (...a: unknown[]) => listDraftExpenses(...a),
  listExpenses: (...a: unknown[]) => listExpenses(...a),
  getExpense: (...a: unknown[]) => getExpense(...a),
}));
vi.mock('@/lib/books/summary', () => ({
  loadBooksSummary: (...a: unknown[]) => loadBooksSummary(...a),
}));

import { GET as listGet, POST as addPost } from '@/app/api/rounds/expenses/route';
import { POST as scanPost } from '@/app/api/rounds/expenses/scan/route';
import { DELETE as deleteOne, GET as getOne, PATCH as saveOne } from '@/app/api/rounds/expenses/[id]/route';
import { GET as receiptGet } from '@/app/api/rounds/expenses/[id]/receipt/route';
import { GET as summaryGet } from '@/app/api/rounds/books/summary/route';

const UUID = '11111111-1111-4111-8111-111111111111';
const ctx = { params: Promise.resolve({ id: UUID }) };
const badCtx = { params: Promise.resolve({ id: 'not-a-uuid' }) };

const draft = {
  id: 'd1',
  status: 'draft' as const,
  spentOn: null,
  merchant: null,
  category: null,
  amount: null,
  vatAmount: null,
  note: null,
  hasReceipt: true,
  source: 'receipt_scan' as const,
  aiConfidence: null,
  createdAt: '2026-10-01T12:00:00.000Z',
};
const saved = {
  ...draft,
  id: 'e1',
  status: 'confirmed' as const,
  spentOn: '2027-03-02',
  merchant: 'Shell',
  category: 'vehicle' as const,
  amount: 10.1,
  source: 'manual' as const,
  hasReceipt: false,
};

function jsonReq(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const addBody = {
  clientMutationId: 'abcd1234',
  spentOn: '2026-09-15',
  category: 'vehicle',
  amount: 12.5,
  tenantId: 'FROM-THE-BODY',
};

function scanReq(opts?: { file?: File | null; clientMutationId?: string; contentLength?: string }): Request {
  const form = new FormData();
  if (opts?.file !== null) {
    form.append('file', opts?.file ?? new File([Uint8Array.from([1, 2, 3])], 'receipt.jpg', { type: 'image/jpeg' }));
  }
  if (opts?.clientMutationId !== undefined) form.append('clientMutationId', opts.clientMutationId);
  else form.append('clientMutationId', 'abcd1234');
  const headers: Record<string, string> = { Authorization: 'Bearer t' };
  if (opts?.contentLength) headers['content-length'] = opts.contentLength;
  return new Request('http://localhost:3000/api/rounds/expenses/scan', { method: 'POST', headers, body: form });
}

beforeEach(() => {
  for (const m of [
    createClientFromBearer, resolveTenantForUser, tenantHasRounds, isTenantAdmin,
    addExpenseCore, saveExpenseCore, deleteExpenseCore, receiptSignedUrl, scanReceiptCore,
    listDraftExpenses, listExpenses, getExpense, loadBooksSummary,
  ]) m.mockReset();
  createClientFromBearer.mockResolvedValue({ supabase: SUPABASE, userId: 'U1' });
  resolveTenantForUser.mockResolvedValue('T1');
  tenantHasRounds.mockResolvedValue(true);
  isTenantAdmin.mockResolvedValue(true);
  listDraftExpenses.mockResolvedValue([draft]);
  listExpenses.mockResolvedValue([saved, { ...saved, id: 'e2', amount: 0.2 }]);
  getExpense.mockResolvedValue(saved);
  addExpenseCore.mockResolvedValue({ ok: true, expenseId: 'e1' });
  saveExpenseCore.mockResolvedValue({ ok: true, expenseId: UUID });
  deleteExpenseCore.mockResolvedValue({ ok: true, expenseId: UUID });
  receiptSignedUrl.mockResolvedValue('https://signed.example/receipt?token=short');
  scanReceiptCore.mockResolvedValue({
    ok: true,
    expenseId: 'e1',
    status: 'draft',
    read: 'read',
    replay: false,
  });
  loadBooksSummary.mockResolvedValue({
    moneyIn: 80,
    moneyOut: 10.3,
    left: 69.7,
    paymentsCount: 4,
    period: { from: '2027-03-01', to: '2027-03-31', label: 'March 2027' },
    moneyInByMethod: [{ method: 'cash', amount: 80 }],
    vat: { rate: 20, vatInEstimate: 1, vatOut: 2 },
  });
});

describe('the guard', () => {
  async function everyRoute() {
    return Promise.all([
      listGet(jsonReq('GET', 'http://localhost:3000/api/rounds/expenses')),
      addPost(jsonReq('POST', 'http://localhost:3000/api/rounds/expenses', addBody)),
      scanPost(scanReq()),
      getOne(jsonReq('GET', 'http://localhost:3000/api/rounds/expenses/' + UUID), ctx),
      saveOne(jsonReq('PATCH', 'http://localhost:3000/api/rounds/expenses/' + UUID, addBody), ctx),
      deleteOne(jsonReq('DELETE', 'http://localhost:3000/api/rounds/expenses/' + UUID), ctx),
      receiptGet(jsonReq('GET', 'http://localhost:3000/api/rounds/expenses/' + UUID + '/receipt'), ctx),
      summaryGet(jsonReq('GET', 'http://localhost:3000/api/rounds/books/summary')),
    ]);
  }

  it('logged out → 401 on every route, before the tenant or Rounds is read', async () => {
    createClientFromBearer.mockResolvedValue(null);
    const responses = await everyRoute();
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(401));
    expect(await responses[0].json()).toEqual({ error: 'Unauthorised' });
    expect(tenantHasRounds).not.toHaveBeenCalled();
    expect(isTenantAdmin).not.toHaveBeenCalled();
    expect(listDraftExpenses).not.toHaveBeenCalled();
  });

  it('no tenant → 403 Forbidden, before the Rounds check', async () => {
    resolveTenantForUser.mockResolvedValue(null);
    const res = await listGet(jsonReq('GET', 'http://localhost:3000/api/rounds/expenses'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
    expect(tenantHasRounds).not.toHaveBeenCalled();
  });

  it('a login without an entitled Rounds plan → 403 plan_ended, before the owner check', async () => {
    tenantHasRounds.mockResolvedValue(false);
    const responses = await everyRoute();
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(403));
    expect(await responses[0].json()).toEqual({ error: 'plan_ended' });
    expect(isTenantAdmin).not.toHaveBeenCalled();
    expect(addExpenseCore).not.toHaveBeenCalled();
    expect(scanReceiptCore).not.toHaveBeenCalled();
    expect(loadBooksSummary).not.toHaveBeenCalled();
  });

  it('a worker gets 403 on every route, including the reads', async () => {
    isTenantAdmin.mockResolvedValue(false);
    const responses = await everyRoute();
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(403));
    expect(await responses[0].json()).toEqual({ error: 'Only the account owner can do this.' });
    expect(listDraftExpenses).not.toHaveBeenCalled();
    expect(getExpense).not.toHaveBeenCalled();
    expect(loadBooksSummary).not.toHaveBeenCalled();
    expect(addExpenseCore).not.toHaveBeenCalled();
    expect(scanReceiptCore).not.toHaveBeenCalled();
  });
});

describe('GET /api/rounds/expenses', () => {
  it('returns drafts (unfiltered) and confirmed expenses for the period, with the spent total', async () => {
    const res = await listGet(jsonReq('GET', 'http://localhost:3000/api/rounds/expenses?period=m-2027-03&tenantId=OTHER'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      drafts: [draft],
      expenses: [saved, { ...saved, id: 'e2', amount: 0.2 }],
      period: { from: '2027-03-01', to: '2027-03-31', label: 'March 2027' },
      total: 10.3,
    });
    expect(listDraftExpenses).toHaveBeenCalledWith(SUPABASE, 'T1');
    expect(listExpenses).toHaveBeenCalledWith(SUPABASE, 'T1', {
      from: '2027-03-01',
      to: '2027-03-31',
      label: 'March 2027',
    });
  });

  it('an unexpected throw is 500 with only the error name logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    listDraftExpenses.mockRejectedValue(new Error('secret db detail'));
    const res = await listGet(jsonReq('GET', 'http://localhost:3000/api/rounds/expenses'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Something went wrong.' });
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain('Error');
    expect(logged).not.toContain('secret db detail');
    spy.mockRestore();
  });
});

describe('POST /api/rounds/expenses', () => {
  it('creates with the tenant from the token and answers 201', async () => {
    const res = await addPost(jsonReq('POST', 'http://localhost:3000/api/rounds/expenses', addBody));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ expenseId: 'e1', replay: false });
    expect(addExpenseCore).toHaveBeenCalledWith(SUPABASE, {
      tenantId: 'T1',
      userId: 'U1',
      values: expect.objectContaining({
        clientMutationId: 'abcd1234',
        spentOn: '2026-09-15',
        category: 'vehicle',
        amount: 12.5,
      }),
    });
    const passed = addExpenseCore.mock.calls[0][1] as { values: Record<string, unknown> };
    expect(passed.values).not.toHaveProperty('tenantId');
  });

  it('a replay of the same clientMutationId is 200 with the same expenseId', async () => {
    addExpenseCore.mockResolvedValue({ ok: true, expenseId: 'existing', replay: true });
    const res = await addPost(jsonReq('POST', 'http://localhost:3000/api/rounds/expenses', addBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ expenseId: 'existing', replay: true });
  });

  it('a core save failure is 503', async () => {
    addExpenseCore.mockResolvedValue({ ok: false, error: "Couldn't save that. Try again." });
    const res = await addPost(jsonReq('POST', 'http://localhost:3000/api/rounds/expenses', addBody));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Couldn't save that. Try again." });
  });

  it('a zod failure is 400 and does not write', async () => {
    const res = await addPost(jsonReq('POST', 'http://localhost:3000/api/rounds/expenses', { ...addBody, amount: 0 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Enter the amount' });
    expect(addExpenseCore).not.toHaveBeenCalled();
  });
});

describe('POST /api/rounds/expenses/scan', () => {
  it('sends the photo to the scan core and answers 201', async () => {
    const res = await scanPost(scanReq());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ expenseId: 'e1', read: 'read', replay: false });
    expect(scanReceiptCore).toHaveBeenCalledWith(ADMIN, {
      tenantId: 'T1',
      userId: 'U1',
      clientMutationId: 'abcd1234',
      file: {
        bytes: Uint8Array.from([1, 2, 3]),
        mime: 'image/jpeg',
        name: 'receipt.jpg',
      },
    });
  });

  it('a replay is 200 with the same expenseId', async () => {
    scanReceiptCore.mockResolvedValue({
      ok: true,
      expenseId: 'existing',
      status: 'draft',
      read: 'unreadable',
      replay: true,
    });
    const res = await scanPost(scanReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ expenseId: 'existing', read: 'unreadable', replay: true });
  });

  it('maps the core errors onto their statuses', async () => {
    const cases = [
      ['too_big', 413, 'That photo is too big (8 MB max).'],
      ['wrong_type', 415, 'Use a photo or a PDF.'],
      ['daily_limit', 429, "That's a lot of receipts for one day — try again tomorrow."],
      ['storage_failed', 503, "Couldn't save that. Try again."],
      ['save_failed', 503, "Couldn't save that. Try again."],
    ] as const;
    for (const [error, status, message] of cases) {
      scanReceiptCore.mockResolvedValueOnce({ ok: false, error });
      const res = await scanPost(scanReq());
      expect([res.status, await res.json()]).toEqual([status, { error: message }]);
    }
  });

  it('a missing photo is 400 and a body over 9 MB is 413 before the core runs', async () => {
    const missing = await scanPost(scanReq({ file: null }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: 'Add a photo.' });

    const huge = await scanPost(scanReq({ contentLength: String(9 * 1024 * 1024 + 1) }));
    expect(huge.status).toBe(413);
    expect(await huge.json()).toEqual({ error: 'That photo is too big (8 MB max).' });
    expect(scanReceiptCore).not.toHaveBeenCalled();
  });

  it('a bad clientMutationId is 400 and does not scan', async () => {
    const res = await scanPost(scanReq({ clientMutationId: 'short' }));
    expect(res.status).toBe(400);
    expect(scanReceiptCore).not.toHaveBeenCalled();
  });
});

describe('one expense', () => {
  it('a bad id is 400 before any read or write', async () => {
    const responses = await Promise.all([
      getOne(jsonReq('GET', 'http://localhost:3000/x'), badCtx),
      saveOne(jsonReq('PATCH', 'http://localhost:3000/x', addBody), badCtx),
      deleteOne(jsonReq('DELETE', 'http://localhost:3000/x'), badCtx),
      receiptGet(jsonReq('GET', 'http://localhost:3000/x'), badCtx),
    ]);
    expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    expect(await responses[0].json()).toEqual({ error: 'Invalid id.' });
    expect(getExpense).not.toHaveBeenCalled();
    expect(saveExpenseCore).not.toHaveBeenCalled();
    expect(deleteExpenseCore).not.toHaveBeenCalled();
    expect(receiptSignedUrl).not.toHaveBeenCalled();
  });

  it('GET returns the row, or 404 when it is gone', async () => {
    const ok = await getOne(jsonReq('GET', 'http://localhost:3000/x'), ctx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(saved);
    expect(getExpense).toHaveBeenCalledWith(SUPABASE, 'T1', UUID);

    getExpense.mockResolvedValueOnce(null);
    const missing = await getOne(jsonReq('GET', 'http://localhost:3000/x'), ctx);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'This expense no longer exists.' });
  });

  it('PATCH and DELETE answer { ok: true }, and 404 when the row is gone', async () => {
    const savedRes = await saveOne(jsonReq('PATCH', 'http://localhost:3000/x', addBody), ctx);
    expect(savedRes.status).toBe(200);
    expect(await savedRes.json()).toEqual({ ok: true });
    expect(saveExpenseCore).toHaveBeenCalledWith(SUPABASE, {
      tenantId: 'T1',
      values: expect.objectContaining({ expenseId: UUID, amount: 12.5 }),
    });

    const deleted = await deleteOne(jsonReq('DELETE', 'http://localhost:3000/x'), ctx);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    expect(deleteExpenseCore).toHaveBeenCalledWith(SUPABASE, ADMIN, { tenantId: 'T1', expenseId: UUID });

    saveExpenseCore.mockResolvedValueOnce({ ok: false, error: 'This expense no longer exists.' });
    const gone = await saveOne(jsonReq('PATCH', 'http://localhost:3000/x', addBody), ctx);
    expect(gone.status).toBe(404);
  });

  it('the receipt link is the 5-minute url from the core, or 404', async () => {
    const ok = await receiptGet(jsonReq('GET', 'http://localhost:3000/x'), ctx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ url: 'https://signed.example/receipt?token=short' });
    expect(receiptSignedUrl).toHaveBeenCalledWith(ADMIN, { tenantId: 'T1', expenseId: UUID });

    receiptSignedUrl.mockResolvedValueOnce(null);
    const missing = await receiptGet(jsonReq('GET', 'http://localhost:3000/x'), ctx);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "There's no photo for this expense." });
  });
});

describe('GET /api/rounds/books/summary', () => {
  it('returns the slim In & out numbers plus the draft count', async () => {
    const res = await summaryGet(jsonReq('GET', 'http://localhost:3000/api/rounds/books/summary?period=m-2027-03'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      moneyIn: 80,
      moneyOut: 10.3,
      left: 69.7,
      paymentsCount: 4,
      label: 'March 2027',
      toCheckCount: 1,
    });
    expect(loadBooksSummary).toHaveBeenCalledWith(SUPABASE, {
      tenantId: 'T1',
      period: { kind: 'month', year: 2027, month: 3 },
    });
    expect(listDraftExpenses).toHaveBeenCalledWith(SUPABASE, 'T1');
  });
});
