import { beforeEach, describe, expect, it, vi } from 'vitest';

const createClientFromBearer = vi.fn();
const resolveTenantForUser = vi.fn();
const tenantHasRounds = vi.fn();
const isTenantAdmin = vi.fn();
const resolveFailedCollection = vi.fn();
const cancelDirectDebit = vi.fn();
const sendDirectDebitInvite = vi.fn();
const getDirectDebitLink = vi.fn();
const getDirectDebitState = vi.fn();
const startGoCardlessConnect = vi.fn();
const disconnectGoCardless = vi.fn();
const refreshVerification = vi.fn();
const isGoCardlessConfigured = vi.fn();
const customerExists = vi.fn();

const ADMIN = {
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({ maybeSingle: () => customerExists() }),
      }),
    }),
  }),
};

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
vi.mock('@/lib/direct-debit/after-collection', () => ({
  resolveFailedCollection: (_a: unknown, p: unknown) => resolveFailedCollection(p),
  cancelDirectDebit: (_a: unknown, p: unknown) => cancelDirectDebit(p),
}));
vi.mock('@/lib/direct-debit/setup', () => ({
  sendDirectDebitInvite: (_a: unknown, p: unknown) => sendDirectDebitInvite(p),
  getDirectDebitLink: (_a: unknown, p: unknown) => getDirectDebitLink(p),
}));
vi.mock('@/lib/direct-debit/state', async () => {
  const actual = await vi.importActual<typeof import('@/lib/direct-debit/state')>('@/lib/direct-debit/state');
  return { ...actual, getDirectDebitState: (...a: unknown[]) => getDirectDebitState(...a) };
});
vi.mock('@/lib/gocardless/oauth', () => ({
  startGoCardlessConnect: (_a: unknown, p: unknown) => startGoCardlessConnect(p),
  disconnectGoCardless: (_a: unknown, p: unknown) => disconnectGoCardless(p),
}));
vi.mock('@/lib/gocardless/connection', () => ({
  refreshVerification: (...a: unknown[]) => refreshVerification(...a),
}));
vi.mock('@/lib/gocardless/config', () => ({
  isGoCardlessConfigured: () => isGoCardlessConfigured(),
  goCardlessConfig: () => ({ verifyUrl: 'https://verify.example.test' }),
}));
vi.mock('@/lib/gocardless/connect-prefill', () => ({
  goCardlessPrefillFor: async () => ({
    email: 'a@b.test',
    givenName: 'Ann',
    familyName: null,
    businessName: 'Sparkle',
  }),
}));
vi.mock('@/lib/data/direct-debit/customer', () => ({
  getCustomerDirectDebit: async () => ({ status: 'active' }),
}));

import { POST as resolveRoute } from '@/app/api/rounds/direct-debit/collections/[id]/route';
import { POST as connectRoute } from '@/app/api/rounds/direct-debit/connect/route';
import { POST as disconnectRoute } from '@/app/api/rounds/direct-debit/disconnect/route';
import { POST as refreshRoute } from '@/app/api/rounds/direct-debit/refresh/route';
import { GET as stateRoute } from '@/app/api/rounds/direct-debit/route';
import { POST as cancelRoute } from '@/app/api/rounds/customers/[id]/direct-debit/cancel/route';
import { POST as inviteRoute } from '@/app/api/rounds/customers/[id]/direct-debit/invite/route';
import { GET as linkRoute } from '@/app/api/rounds/customers/[id]/direct-debit/link/route';
import { GET as customerRoute } from '@/app/api/rounds/customers/[id]/direct-debit/route';

const UUID = '11111111-1111-4111-8111-111111111111';
const ctx = { params: Promise.resolve({ id: UUID }) };

function req(method: 'GET' | 'POST', body: unknown = {}): Request {
  return new Request('http://localhost:3000/api/rounds/x', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  for (const m of [
    createClientFromBearer, resolveTenantForUser, tenantHasRounds, isTenantAdmin, resolveFailedCollection,
    cancelDirectDebit, sendDirectDebitInvite, getDirectDebitLink, getDirectDebitState,
    startGoCardlessConnect, disconnectGoCardless, refreshVerification, isGoCardlessConfigured, customerExists,
  ]) m.mockReset();
  createClientFromBearer.mockResolvedValue({ supabase: {}, userId: 'U1' });
  resolveTenantForUser.mockResolvedValue('T1');
  tenantHasRounds.mockResolvedValue(true);
  isTenantAdmin.mockResolvedValue(true);
  getDirectDebitState.mockResolvedValue('on');
  isGoCardlessConfigured.mockReturnValue(true);
  customerExists.mockResolvedValue({ data: { id: UUID }, error: null });
});

describe('the guard', () => {
  it('logged out → 401 on every route, before anything else is read', async () => {
    createClientFromBearer.mockResolvedValue(null);
    const responses = await Promise.all([
      stateRoute(req('GET')),
      connectRoute(req('POST', { hasAccount: true })),
      refreshRoute(req('POST')),
      disconnectRoute(req('POST')),
      customerRoute(req('GET'), ctx),
      inviteRoute(req('POST'), ctx),
      linkRoute(req('GET'), ctx),
      cancelRoute(req('POST'), ctx),
      resolveRoute(req('POST', { action: 'leave' }), ctx),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(9).fill(401));
    expect(tenantHasRounds).not.toHaveBeenCalled();
  });

  it('no tenant → 403 Forbidden; a business without Rounds → 403 plan_ended', async () => {
    resolveTenantForUser.mockResolvedValueOnce(null);
    expect((await stateRoute(req('GET'))).status).toBe(403);

    tenantHasRounds.mockResolvedValue(false);
    const pro = await stateRoute(req('GET'));
    expect(pro.status).toBe(403);
    expect(await pro.json()).toEqual({ error: 'plan_ended' });
  });

  it('a worker can read but every action is 403', async () => {
    isTenantAdmin.mockResolvedValue(false);
    refreshVerification.mockResolvedValue(null);
    expect((await stateRoute(req('GET'))).status).not.toBe(403);
    expect((await customerRoute(req('GET'), ctx)).status).toBe(200);

    const refused = [
      await connectRoute(req('POST', { hasAccount: true })),
      await refreshRoute(req('POST')),
      await disconnectRoute(req('POST')),
      await inviteRoute(req('POST'), ctx),
      await cancelRoute(req('POST'), ctx),
      await resolveRoute(req('POST', { action: 'leave' }), ctx),
    ];
    expect(refused.map((r) => r.status)).toEqual(Array(6).fill(403));
    expect(await refused[0].json()).toEqual({ error: 'Only the account owner can do this.' });
    expect(startGoCardlessConnect).not.toHaveBeenCalled();
    expect(resolveFailedCollection).not.toHaveBeenCalled();
  });
});

describe('GET /api/rounds/direct-debit', () => {
  it('gives only the listed fields, and the verify link only when details are needed', async () => {
    refreshVerification.mockResolvedValue({
      status: 'connected',
      verification_status: 'action_required',
      connected_email: 'owner@b.test',
      access_token_enc: 'SECRET',
    });
    const res = await stateRoute(req('GET'));
    const json = await res.json();
    expect(json).toEqual({
      state: 'needs_details',
      configured: true,
      connectedEmail: 'owner@b.test',
      existingToLink: 0,
      verifyUrl: 'https://verify.example.test',
    });
    expect(JSON.stringify(json)).not.toContain('SECRET');
    expect(refreshVerification.mock.calls[0][2]).toBeUndefined(); // the 5-minute rule, not forced
  });
});

describe('POST actions', () => {
  it('connect: from app, with the prefill; not configured → 400', async () => {
    startGoCardlessConnect.mockResolvedValue('https://connect.example.test/authorize');
    const ok = await connectRoute(req('POST', { hasAccount: false }));
    expect(await ok.json()).toEqual({ url: 'https://connect.example.test/authorize' });
    expect(startGoCardlessConnect).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'T1', from: 'app', hasAccount: false }),
    );

    expect((await connectRoute(req('POST', {}))).status).toBe(400);
    isGoCardlessConfigured.mockReturnValue(false);
    const off = await connectRoute(req('POST', { hasAccount: true }));
    expect(off.status).toBe(400);
    expect(await off.json()).toEqual({ error: "Direct Debit isn't set up on this server yet." });
  });

  it('refresh forces; disconnect answers ok', async () => {
    refreshVerification.mockResolvedValue({ status: 'connected', verification_status: 'successful' });
    expect(await (await refreshRoute(req('POST'))).json()).toEqual({ state: 'on' });
    expect(refreshVerification.mock.calls[0][2]).toEqual({ force: true });
    expect(await (await disconnectRoute(req('POST'))).json()).toEqual({ ok: true });
    expect(disconnectGoCardless).toHaveBeenCalledWith({ tenantId: 'T1' });
  });

  it('resolve: ok, 409 when already sorted, 400 for another refusal, 400 for a bad id or action', async () => {
    resolveFailedCollection.mockResolvedValueOnce({ ok: true, newCollectionId: 'C9' });
    const ok = await resolveRoute(req('POST', { action: 'collect_again' }), ctx);
    expect(await ok.json()).toEqual({ ok: true, newCollectionId: 'C9' });
    expect(resolveFailedCollection).toHaveBeenCalledWith({
      tenantId: 'T1', userId: 'U1', collectionId: UUID, action: 'collect_again',
    });

    resolveFailedCollection.mockResolvedValueOnce({ ok: false, error: 'This has already been sorted.' });
    expect((await resolveRoute(req('POST', { action: 'leave' }), ctx)).status).toBe(409);
    resolveFailedCollection.mockResolvedValueOnce({ ok: false, error: "Couldn't save that." });
    expect((await resolveRoute(req('POST', { action: 'leave' }), ctx)).status).toBe(400);

    expect((await resolveRoute(req('POST', { action: 'nope' }), ctx)).status).toBe(400);
    const badId = { params: Promise.resolve({ id: 'not-a-uuid' }) };
    expect((await resolveRoute(req('POST', { action: 'leave' }), badId)).status).toBe(400);
  });

  it('a body can never choose the tenant', async () => {
    resolveFailedCollection.mockResolvedValue({ ok: true, newCollectionId: null });
    await resolveRoute(req('POST', { action: 'leave', tenantId: 'OTHER' }), ctx);
    expect(resolveFailedCollection.mock.calls[0][0].tenantId).toBe('T1');
  });

  it('invite and link need the business On; otherwise pass the core result through', async () => {
    getDirectDebitState.mockResolvedValue('off');
    const off = await inviteRoute(req('POST'), ctx);
    expect(off.status).toBe(400);
    expect(await off.json()).toEqual({ error: 'Connect GoCardless first.' });
    expect((await linkRoute(req('GET'), ctx)).status).toBe(400);
    expect(sendDirectDebitInvite).not.toHaveBeenCalled();

    getDirectDebitState.mockResolvedValue('on');
    sendDirectDebitInvite.mockResolvedValue({ ok: true, channel: 'sms' });
    expect(await (await inviteRoute(req('POST'), ctx)).json()).toEqual({ channel: 'sms' });
    getDirectDebitLink.mockResolvedValue({ ok: true, url: 'https://x.test/pay/t?dd=1', shareText: 'Hi' });
    expect(await (await linkRoute(req('GET'), ctx)).json()).toEqual({
      url: 'https://x.test/pay/t?dd=1',
      shareText: 'Hi',
    });
    sendDirectDebitInvite.mockResolvedValue({ ok: false, error: 'No email or mobile for this customer — copy the link instead.' });
    expect((await inviteRoute(req('POST'), ctx)).status).toBe(400);
  });

  it('cancel passes stillCollecting through; a throw is a 500 that logs only the route', async () => {
    cancelDirectDebit.mockResolvedValueOnce({ ok: true, stillCollecting: 15 });
    expect(await (await cancelRoute(req('POST'), ctx)).json()).toEqual({ stillCollecting: 15 });

    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    cancelDirectDebit.mockRejectedValueOnce(new Error('secret detail'));
    const res = await cancelRoute(req('POST'), ctx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Something went wrong.' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret detail');
    log.mockRestore();
  });

  it('customer picture: another business\'s customer is 404', async () => {
    customerExists.mockResolvedValue({ data: null, error: null });
    expect((await customerRoute(req('GET'), ctx)).status).toBe(404);
    customerExists.mockResolvedValue({ data: { id: UUID }, error: null });
    expect(await (await customerRoute(req('GET'), ctx)).json()).toEqual({
      status: 'active',
      businessState: 'on',
    });
  });
});
