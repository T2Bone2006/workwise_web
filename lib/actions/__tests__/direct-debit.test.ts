import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = {
  tenantId: 'tenant-1' as string | null,
  hasRounds: true,
  userId: 'user-1' as string | null,
  admin: true,
  dd: 'on',
};
const linkExisting = vi.fn();
const ignoreExisting = vi.fn();
const unlinkExisting = vi.fn();
const resolveFailed = vi.fn();
const cancelDd = vi.fn();
const disconnect = vi.fn();
const sendInvite = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data/tenant', () => ({ getTenantIdForCurrentUser: async () => session.tenantId }));
vi.mock('@/lib/data/tenant-products', () => ({ getTenantProducts: async () => ({ hasRounds: session.hasRounds }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: session.userId ? { id: session.userId } : null } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/stripe/connect', () => ({ isTenantAdmin: async () => session.admin }));
vi.mock('@/lib/gocardless/connection', () => ({
  getConnection: async () => ({ status: 'connected' }),
  refreshVerification: async () => ({ status: 'connected', verification_status: 'successful' }),
}));
vi.mock('@/lib/gocardless/oauth', () => ({ disconnectGoCardless: (...a: unknown[]) => disconnect(...a) }));
vi.mock('@/lib/direct-debit/state', () => ({
  getDirectDebitState: async () => session.dd,
  directDebitState: () => 'on',
}));
vi.mock('@/lib/direct-debit/existing', () => ({
  linkExistingMandate: (...a: unknown[]) => linkExisting(...a),
  ignoreExistingMandate: (...a: unknown[]) => ignoreExisting(...a),
  unlinkExistingMandate: (...a: unknown[]) => unlinkExisting(...a),
  refreshMandateLinks: async () => ({ found: 0, autoLinked: 0, probable: 0, unmatched: 0, otherApp: 0 }),
}));
vi.mock('@/lib/direct-debit/after-collection', () => ({
  resolveFailedCollection: (...a: unknown[]) => resolveFailed(...a),
  cancelDirectDebit: (...a: unknown[]) => cancelDd(...a),
}));
vi.mock('@/lib/direct-debit/setup', () => ({
  sendDirectDebitInvite: (...a: unknown[]) => sendInvite(...a),
  directDebitInviteUrl: async () => 'https://x/pay/tok?dd=1',
}));
vi.mock('@/lib/messaging/brand', () => ({ getTenantMessagingContext: async () => null }));

import {
  cancelDirectDebitAction,
  disconnectGoCardlessAction,
  ignoreExistingDirectDebitAction,
  linkExistingDirectDebitAction,
  refreshGoCardlessStatusAction,
  resolveFailedCollectionAction,
  sendDirectDebitInviteAction,
  unlinkExistingDirectDebitAction,
} from '@/lib/actions/direct-debit';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  Object.assign(session, { tenantId: 'tenant-1', hasRounds: true, userId: 'user-1', admin: true, dd: 'on' });
  for (const m of [linkExisting, ignoreExisting, unlinkExisting, resolveFailed, cancelDd, disconnect, sendInvite]) m.mockReset();
  linkExisting.mockResolvedValue({ ok: true, directDebitId: 'dd' });
  ignoreExisting.mockResolvedValue({ ok: true });
  unlinkExisting.mockResolvedValue({ ok: true });
  resolveFailed.mockResolvedValue({ ok: true, newCollectionId: null });
  cancelDd.mockResolvedValue({ ok: true, stillCollecting: 0 });
  sendInvite.mockResolvedValue({ ok: true, channel: 'email' });
});

const everyAction: [string, () => Promise<{ ok: boolean; error?: string }>][] = [
  ['refresh', () => refreshGoCardlessStatusAction()],
  ['disconnect', () => disconnectGoCardlessAction()],
  ['link', () => linkExistingDirectDebitAction({ linkId: ID, customerId: ID2, confirmStoppedOldApp: true })],
  ['ignore', () => ignoreExistingDirectDebitAction({ linkId: ID })],
  ['unlink', () => unlinkExistingDirectDebitAction({ linkId: ID })],
  ['invite', () => sendDirectDebitInviteAction({ customerId: ID })],
  ['resolve', () => resolveFailedCollectionAction({ collectionId: ID, action: 'leave' })],
  ['cancel', () => cancelDirectDebitAction({ customerId: ID })],
];

describe('every action refuses in the right order', () => {
  it.each(everyAction)('%s: not signed in', async (_n, run) => {
    session.tenantId = null;
    expect(await run()).toEqual({ ok: false, error: 'Not signed in.' });
  });

  it.each(everyAction)('%s: Pro (no Rounds)', async (_n, run) => {
    session.hasRounds = false;
    expect(await run()).toEqual({ ok: false, error: 'Rounds only.' });
  });

  it.each(everyAction)('%s: a worker login (not the owner)', async (_n, run) => {
    session.admin = false;
    expect(await run()).toEqual({ ok: false, error: 'Only the account owner can do this.' });
    for (const m of [linkExisting, ignoreExisting, unlinkExisting, resolveFailed, cancelDd, disconnect, sendInvite]) {
      expect(m).not.toHaveBeenCalled();
    }
  });
});

describe('the owner', () => {
  it('actions pass the session tenant and user, never anything from the input', async () => {
    await linkExistingDirectDebitAction({ linkId: ID, customerId: ID2, confirmStoppedOldApp: true });
    expect(linkExisting).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      userId: 'user-1',
      linkId: ID,
      customerId: ID2,
      confirmStoppedOldApp: true,
    });
    await resolveFailedCollectionAction({ collectionId: ID, action: 'collect_again' });
    expect(resolveFailed).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 'tenant-1',
      userId: 'user-1',
      collectionId: ID,
      action: 'collect_again',
    });
    // An attacker-supplied tenantId is dropped by the schema.
    await ignoreExistingDirectDebitAction({ linkId: ID, tenantId: 'other' } as never);
    expect(ignoreExisting).toHaveBeenCalledWith(expect.anything(), { tenantId: 'tenant-1', userId: 'user-1', linkId: ID });
  });

  it('bad input is refused before anything happens', async () => {
    expect((await linkExistingDirectDebitAction({ linkId: 'nope', customerId: ID2, confirmStoppedOldApp: true })).ok).toBe(false);
    expect((await linkExistingDirectDebitAction({ linkId: ID, customerId: ID2, confirmStoppedOldApp: 'yes' as never })).ok).toBe(false);
    expect((await resolveFailedCollectionAction({ collectionId: ID, action: 'delete' as never })).ok).toBe(false);
    expect((await cancelDirectDebitAction({ customerId: 'x' })).ok).toBe(false);
    for (const m of [linkExisting, resolveFailed, cancelDd]) expect(m).not.toHaveBeenCalled();
  });

  it("the customer-facing send needs Direct Debit to be On", async () => {
    session.dd = 'verifying';
    expect(await sendDirectDebitInviteAction({ customerId: ID })).toEqual({
      ok: false,
      error: "Direct Debit isn't on yet — connect GoCardless in Settings → Payments.",
    });
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it('passes the core result through (errors and successes)', async () => {
    linkExisting.mockResolvedValue({ ok: false, error: 'This one has already been dealt with.' });
    expect(await linkExistingDirectDebitAction({ linkId: ID, customerId: ID2, confirmStoppedOldApp: false })).toEqual({
      ok: false,
      error: 'This one has already been dealt with.',
    });
    cancelDd.mockResolvedValue({ ok: true, stillCollecting: 15 });
    expect(await cancelDirectDebitAction({ customerId: ID })).toEqual({ ok: true, stillCollecting: 15 });
    expect(await sendDirectDebitInviteAction({ customerId: ID })).toEqual({ ok: true, channel: 'email' });
    expect(await disconnectGoCardlessAction()).toEqual({ ok: true });
    expect(disconnect).toHaveBeenCalledWith(expect.anything(), { tenantId: 'tenant-1' });
  });
});
