import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminRounds = vi.fn();
const listAccess = vi.fn();
const inviteAccountant = vi.fn();
const resendInvite = vi.fn();
const removeAccountant = vi.fn();
const sendAccountantInvite = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/require-admin-rounds', () => ({
  requireAdminRounds: (...a: unknown[]) => requireAdminRounds(...a),
}));
vi.mock('@/lib/accountant/access', () => ({
  listAccess: (...a: unknown[]) => listAccess(...a),
  inviteAccountant: (...a: unknown[]) => inviteAccountant(...a),
  resendInvite: (...a: unknown[]) => resendInvite(...a),
  removeAccountant: (...a: unknown[]) => removeAccountant(...a),
}));
vi.mock('@/lib/emails/accountant-invite', () => ({
  sendAccountantInvite: (...a: unknown[]) => sendAccountantInvite(...a),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Bright Windows' } }) }) }),
    }),
  }),
}));

import {
  inviteAccountantAction,
  removeAccountantAction,
  resendAccountantInviteAction,
} from '@/lib/actions/accountant';

const owner = { success: true, tenantId: 't1', userId: 'u1', supabase: {} };
const OWNER_ONLY = { success: false, error: 'Only the account owner can do this.' };

beforeEach(() => {
  for (const m of [requireAdminRounds, listAccess, inviteAccountant, resendInvite, removeAccountant, sendAccountantInvite]) m.mockReset();
  requireAdminRounds.mockResolvedValue(owner);
  listAccess.mockResolvedValue([]);
  inviteAccountant.mockResolvedValue({ ok: true, accessId: 'a1', linkToken: 'L'.repeat(43) });
  sendAccountantInvite.mockResolvedValue({ ok: true });
  removeAccountant.mockResolvedValue({ ok: true });
});

describe('who may do it', () => {
  it('refuses everything for someone who is not the account owner of a Rounds business', async () => {
    requireAdminRounds.mockResolvedValue(OWNER_ONLY);
    expect(await inviteAccountantAction({ email: 'a@b.com' })).toEqual(OWNER_ONLY);
    expect(await resendAccountantInviteAction({ accessId: 'a1' })).toEqual(OWNER_ONLY);
    expect(await removeAccountantAction({ accessId: 'a1' })).toEqual(OWNER_ONLY);
    expect(inviteAccountant).not.toHaveBeenCalled();
    expect(resendInvite).not.toHaveBeenCalled();
    expect(removeAccountant).not.toHaveBeenCalled();
    expect(sendAccountantInvite).not.toHaveBeenCalled();
  });

  it('asks the guard for the Rounds-only message', async () => {
    await inviteAccountantAction({ email: 'a@b.com' });
    expect(requireAdminRounds).toHaveBeenCalledWith('Accountant access is part of Rounds.');
  });
});

describe('inviteAccountantAction', () => {
  it('invites, then emails the link to the lower-cased address', async () => {
    expect(await inviteAccountantAction({ email: '  Pat@Accounts.co.uk ', name: 'Pat' })).toEqual({ success: true });
    expect(inviteAccountant).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 't1', userId: 'u1', email: '  Pat@Accounts.co.uk ', name: 'Pat',
    });
    expect(sendAccountantInvite).toHaveBeenCalledWith({
      to: 'pat@accounts.co.uk', businessName: 'Bright Windows', inviterName: null, linkToken: 'L'.repeat(43),
    });
  });

  it('refuses a fourth accountant before doing anything', async () => {
    listAccess.mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]);
    expect(await inviteAccountantAction({ email: 'a@b.com' })).toEqual({
      success: false, error: 'You can give up to 3 people access.',
    });
    expect(inviteAccountant).not.toHaveBeenCalled();
    expect(sendAccountantInvite).not.toHaveBeenCalled();
  });

  it('allows the third', async () => {
    listAccess.mockResolvedValue([{ id: '1' }, { id: '2' }]);
    expect((await inviteAccountantAction({ email: 'a@b.com' })).success).toBe(true);
  });

  it('passes on the message for a bad or duplicate address', async () => {
    inviteAccountant.mockResolvedValueOnce({ ok: false, error: 'Enter a valid email address.' });
    expect(await inviteAccountantAction({ email: 'nope' })).toEqual({ success: false, error: 'Enter a valid email address.' });
    inviteAccountant.mockResolvedValueOnce({ ok: false, error: 'That accountant already has access.' });
    expect(await inviteAccountantAction({ email: 'a@b.com' })).toEqual({ success: false, error: 'That accountant already has access.' });
    expect(sendAccountantInvite).not.toHaveBeenCalled();
  });

  it('removes the access again when the email cannot be sent, so there is no invisible access', async () => {
    sendAccountantInvite.mockResolvedValue({ ok: false });
    expect(await inviteAccountantAction({ email: 'a@b.com' })).toEqual({
      success: false, error: "Couldn't send the email. Try again.",
    });
    expect(removeAccountant).toHaveBeenCalledWith(expect.anything(), { tenantId: 't1', accessId: 'a1', userId: 'u1' });
  });

  it("fails plainly if it can't count the current accountants", async () => {
    listAccess.mockRejectedValue(new Error('boom'));
    expect(await inviteAccountantAction({ email: 'a@b.com' })).toEqual({ success: false, error: "Couldn't do that. Try again." });
    expect(inviteAccountant).not.toHaveBeenCalled();
  });
});

describe('resendAccountantInviteAction', () => {
  it('rotates the link and emails it to the accountant on file', async () => {
    resendInvite.mockResolvedValue({ ok: true, linkToken: 'N'.repeat(43), email: 'pat@accounts.co.uk' });
    expect(await resendAccountantInviteAction({ accessId: 'a1' })).toEqual({ success: true });
    expect(resendInvite).toHaveBeenCalledWith(expect.anything(), { tenantId: 't1', accessId: 'a1' });
    expect(sendAccountantInvite).toHaveBeenCalledWith(expect.objectContaining({ to: 'pat@accounts.co.uk', linkToken: 'N'.repeat(43) }));
  });

  it('says so when the email fails, and when the accountant has gone', async () => {
    resendInvite.mockResolvedValue({ ok: true, linkToken: 'N'.repeat(43), email: 'p@a.com' });
    sendAccountantInvite.mockResolvedValue({ ok: false });
    expect(await resendAccountantInviteAction({ accessId: 'a1' })).toEqual({ success: false, error: "Couldn't send the email. Try again." });
    resendInvite.mockResolvedValue({ ok: false, error: 'That accountant no longer has access.' });
    expect(await resendAccountantInviteAction({ accessId: 'a1' })).toEqual({ success: false, error: 'That accountant no longer has access.' });
  });
});

describe('removeAccountantAction', () => {
  it('removes within this business only', async () => {
    expect(await removeAccountantAction({ accessId: 'a1' })).toEqual({ success: true });
    expect(removeAccountant).toHaveBeenCalledWith(expect.anything(), { tenantId: 't1', accessId: 'a1', userId: 'u1' });
  });

  it('passes on "no longer has access"', async () => {
    removeAccountant.mockResolvedValue({ ok: false, error: 'That accountant no longer has access.' });
    expect(await removeAccountantAction({ accessId: 'a1' })).toEqual({ success: false, error: 'That accountant no longer has access.' });
  });
});
