import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const ctx = { userId: 'u-dave', tenantId: 't1', workerId: 'w-dave', personId: 'p-dave', name: 'Dave' };
const jobsDb = { owner: 'w-dave' as string | null, db: null as unknown };
vi.mock('@/lib/api/staff-request', async () => {
  const { NextResponse } = await import('next/server');
  return {
    requireStaffApi: async (request: Request) => {
      if (!request.headers.get('authorization')) {
        return { ok: false, response: NextResponse.json({ error: 'Unauthorised' }, { status: 401 }) };
      }
      return { ok: true, ctx: { ...ctx, db: jobsDb.db } };
    },
    NOT_YOURS: 'not_yours',
    staffJson: (body: unknown, status = 200) => NextResponse.json(body, { status }),
    ownsVisit: async () => jobsDb.owner === 'w-dave',
  };
});

const completeVisitCore = vi.fn();
vi.mock('@/lib/rounds/visit-transitions', () => ({ completeVisitCore: (...a: unknown[]) => completeVisitCore(...a) }));
const skipVisitWithLog = vi.fn();
const moveRemainingWithLog = vi.fn();
const skipRemainingCore = vi.fn();
vi.mock('@/lib/rounds/visit-changes', () => ({
  skipVisitWithLog: (...a: unknown[]) => skipVisitWithLog(...a),
  moveRemainingWithLog: (...a: unknown[]) => moveRemainingWithLog(...a),
  skipRemainingCore: (...a: unknown[]) => skipRemainingCore(...a),
}));
const sendVisitDoneAfterSkip = vi.fn();
vi.mock('@/lib/payments/notify', () => ({ sendVisitDoneAfterSkip: (...a: unknown[]) => sendVisitDoneAfterSkip(...a) }));

import { POST as complete } from '@/app/api/staff/visits/complete/route';
import { POST as skip } from '@/app/api/staff/visits/skip/route';
import { POST as moveRemaining } from '@/app/api/staff/visits/move-remaining/route';
import { POST as skipRemaining } from '@/app/api/staff/visits/skip-remaining/route';

const JOB = '11111111-1111-4111-8111-111111111111';
const post = (body: unknown, auth = true) =>
  new Request('http://localhost/api/staff/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer x' } : {}) },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jobsDb.owner = 'w-dave';
  jobsDb.db = { tag: 'admin' };
  for (const f of [completeVisitCore, skipVisitWithLog, moveRemainingWithLog, skipRemainingCore, sendVisitDoneAfterSkip]) f.mockReset();
  completeVisitCore.mockResolvedValue({ success: true, alreadyCompleted: false, skippedElsewhere: false, paymentId: 'pay-1', paymentDuplicate: false });
  skipVisitWithLog.mockResolvedValue({ success: true, alreadySkipped: false, changeId: 'chg-1' });
  moveRemainingWithLog.mockResolvedValue({ success: true, moved: 3, changeId: 'chg-2' });
  skipRemainingCore.mockResolvedValue({ success: true, skipped: 2, changeId: 'chg-3' });
});

describe('Done', () => {
  it('holds cash for the lead, ignores sendInvoice, and acts as the lead', async () => {
    const res = await complete(post({ jobId: JOB, payment: { method: 'cash', amount: 20 }, sendInvoice: true, clientMutationId: 'abcdefgh1' }));
    expect(res.status).toBe(200);
    const args = completeVisitCore.mock.calls[0][1];
    expect(args).toMatchObject({
      tenantId: 't1',
      jobId: JOB,
      payment: { method: 'cash', amount: 20 },
      clientMutationId: 'abcdefgh1',
      collectedBy: { workerId: 'w-dave', name: 'Dave' },
      actor: { userId: 'u-dave', workerId: 'w-dave' },
    });
    expect(args.sendInvoice).toBeUndefined();
    expect(await res.json()).toMatchObject({ success: true, paymentId: 'pay-1' });
  });

  it('refuses a visit that is not theirs, and does nothing', async () => {
    jobsDb.owner = 'w-lee';
    const res = await complete(post({ jobId: JOB }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_yours' });
    expect(completeVisitCore).not.toHaveBeenCalled();
  });

  it('401 with no token, 400 for a bad body, 503 for a temporary failure', async () => {
    expect((await complete(post({ jobId: JOB }, false))).status).toBe(401);
    expect((await complete(post({ jobId: 'nope' }))).status).toBe(400);
    completeVisitCore.mockResolvedValue({ success: false, error: 'try again', retryable: true });
    expect((await complete(post({ jobId: JOB }))).status).toBe(503);
  });
});

describe('Skip', () => {
  it('never tells the customer and refuses someone else’s visit', async () => {
    const ok = await skip(post({ jobId: JOB, reason: 'no_access', notifyCustomer: true }));
    expect(ok.status).toBe(200);
    expect(skipVisitWithLog.mock.calls[0][1]).toMatchObject({ jobId: JOB, notifyCustomer: false, actor: { workerId: 'w-dave' } });
    expect(sendVisitDoneAfterSkip).toHaveBeenCalled();

    jobsDb.owner = 'w-lee';
    skipVisitWithLog.mockClear();
    expect((await skip(post({ jobId: JOB, reason: 'no_access' }))).status).toBe(403);
    expect(skipVisitWithLog).not.toHaveBeenCalled();
  });

  it('maps already-completed to 409', async () => {
    skipVisitWithLog.mockResolvedValue({ success: false, error: 'This visit is already done.', code: 'already_completed' });
    expect((await skip(post({ jobId: JOB, reason: 'no_access' }))).status).toBe(409);
  });
});

describe('Move remaining / Skip remaining', () => {
  it('moves only their own stops and never texts', async () => {
    const res = await moveRemaining(post({ fromDate: '2026-10-12', toDate: '2026-10-13', notifyCustomers: true }));
    expect(res.status).toBe(200);
    expect(moveRemainingWithLog.mock.calls[0][1]).toMatchObject({
      tenantId: 't1', fromDate: '2026-10-12', toDate: '2026-10-13', notifyCustomers: false, workerId: 'w-dave',
    });
    expect(await res.json()).toMatchObject({ moved: 3, changeId: 'chg-2' });
  });

  it('skips only their own leftovers and never texts', async () => {
    const res = await skipRemaining(post({ date: '2026-10-12', notifyCustomers: true }));
    expect(res.status).toBe(200);
    expect(skipRemainingCore.mock.calls[0][1]).toMatchObject({ date: '2026-10-12', notifyCustomers: false, workerId: 'w-dave' });
  });

  it('answers 401 without a token and 400 for a bad date', async () => {
    expect((await moveRemaining(post({}, false))).status).toBe(401);
    expect((await moveRemaining(post({ fromDate: 'x', toDate: 'y' }))).status).toBe(400);
    expect((await skipRemaining(post({ date: 'x' }))).status).toBe(400);
  });
});
