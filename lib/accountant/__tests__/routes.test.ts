import { beforeEach, describe, expect, it, vi } from 'vitest';

const issueLoginCode = vi.fn();
const verifyLoginCode = vi.fn();
const sendAccountantCode = vi.fn();

vi.mock('@/lib/accountant/access', async (orig) => ({
  ...(await orig<typeof import('@/lib/accountant/access')>()),
  issueLoginCode: (...a: unknown[]) => issueLoginCode(...a),
  verifyLoginCode: (...a: unknown[]) => verifyLoginCode(...a),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/emails/accountant-code', () => ({
  sendAccountantCode: (...a: unknown[]) => sendAccountantCode(...a),
}));

import { POST as codePost } from '@/app/api/accountant/[token]/code/route';
import { POST as verifyPost } from '@/app/api/accountant/[token]/verify/route';

const ctx = { params: Promise.resolve({ token: 'a'.repeat(43) }) };
const post = (body?: unknown, raw?: string) =>
  new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

beforeEach(() => {
  issueLoginCode.mockReset();
  verifyLoginCode.mockReset();
  sendAccountantCode.mockReset();
});

describe('POST /api/accountant/[token]/code', () => {
  it('emails the code and answers { sent: true }', async () => {
    issueLoginCode.mockResolvedValue({ ok: true, accessId: 'a', email: 'acc@x.com', code: '123456', businessName: 'Bright' });
    sendAccountantCode.mockResolvedValue({ ok: true });
    const res = await codePost(post(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(sendAccountantCode).toHaveBeenCalledWith({ to: 'acc@x.com', businessName: 'Bright', code: '123456' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('never puts the code in the response', async () => {
    issueLoginCode.mockResolvedValue({ ok: true, accessId: 'a', email: 'acc@x.com', code: '123456', businessName: 'Bright' });
    sendAccountantCode.mockResolvedValue({ ok: true });
    expect(JSON.stringify(await (await codePost(post(), ctx)).json())).not.toContain('123456');
  });

  it('maps not_found, too_many and failures to the exact messages', async () => {
    issueLoginCode.mockResolvedValueOnce({ ok: false, error: 'not_found' });
    let res = await codePost(post(), ctx);
    expect([res.status, await res.json()]).toEqual([404, { error: 'This link no longer works.' }]);

    issueLoginCode.mockResolvedValueOnce({ ok: false, error: 'too_many' });
    res = await codePost(post(), ctx);
    expect([res.status, await res.json()]).toEqual([429, { error: 'Too many codes. Wait an hour and try again.' }]);

    issueLoginCode.mockResolvedValueOnce({ ok: false, error: 'failed' });
    res = await codePost(post(), ctx);
    expect([res.status, await res.json()]).toEqual([500, { error: "Couldn't send a code. Try again." }]);
  });

  it('answers 500 when the email cannot be sent', async () => {
    issueLoginCode.mockResolvedValue({ ok: true, accessId: 'a', email: 'acc@x.com', code: '123456', businessName: 'Bright' });
    sendAccountantCode.mockResolvedValue({ ok: false });
    const res = await codePost(post(), ctx);
    expect([res.status, await res.json()]).toEqual([500, { error: "Couldn't send a code. Try again." }]);
  });
});

describe('POST /api/accountant/[token]/verify', () => {
  it('refuses anything that is not six digits with 400, without checking', async () => {
    for (const body of [{}, { code: '' }, { code: '12345' }, { code: '1234567' }, { code: 'abcdef' }, { code: 123456 }, null]) {
      const res = await verifyPost(post(body), ctx);
      expect([res.status, await res.json()]).toEqual([400, { error: 'Enter the 6-digit code.' }]);
    }
    const bad = await verifyPost(post(undefined, 'not json'), ctx);
    expect(bad.status).toBe(400);
    expect(verifyLoginCode).not.toHaveBeenCalled();
  });

  it('sets the session cookie: httpOnly, lax, path /accountant, 30 days', async () => {
    verifyLoginCode.mockResolvedValue({ ok: true, sessionToken: 's'.repeat(43), expiresAt: 'x' });
    const res = await verifyPost(post({ code: ' 123456 ' }), ctx);
    expect(res.status).toBe(200);
    expect(verifyLoginCode).toHaveBeenCalledWith({}, { linkToken: 'a'.repeat(43), code: '123456' });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`ww_accountant=${'s'.repeat(43)}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain('Path=/accountant');
    expect(cookie).toContain('Max-Age=2592000');
    // The raw session token is in the cookie only, never in the body.
    expect(JSON.stringify(await res.json())).not.toContain('s'.repeat(43));
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('maps a wrong code, an expired one and a dead link to the exact messages, with no cookie', async () => {
    verifyLoginCode.mockResolvedValueOnce({ ok: false, error: 'wrong_code' });
    let res = await verifyPost(post({ code: '123456' }), ctx);
    expect([res.status, await res.json()]).toEqual([400, { error: "That code isn't right." }]);
    expect(res.headers.get('set-cookie')).toBeNull();

    for (const error of ['expired', 'not_found']) {
      verifyLoginCode.mockResolvedValueOnce({ ok: false, error });
      res = await verifyPost(post({ code: '123456' }), ctx);
      expect([res.status, await res.json()]).toEqual([400, { error: 'That code has expired. Send a new one.' }]);
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('answers 500 on an internal failure, with no cookie', async () => {
    verifyLoginCode.mockResolvedValueOnce({ ok: false, error: 'failed' });
    const res = await verifyPost(post({ code: '123456' }), ctx);
    expect(res.status).toBe(500);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
