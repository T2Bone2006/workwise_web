import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  endSession,
  inviteAccountant,
  issueLoginCode,
  listAccess,
  loadAccountantContext,
  removeAccountant,
  resendInvite,
  verifyLoginCode,
} from '@/lib/accountant/access';

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

/**
 * In-memory stand-in for the service-role client, with the three accountant
 * tables, tenants, and the unique indexes the migration creates.
 */
function fakeDb() {
  const tables: Record<string, Row[]> = {
    accountant_access: [],
    accountant_login_codes: [],
    accountant_sessions: [],
    tenants: [{ id: 't1', name: 'Bright Windows' }, { id: 't2', name: 'Other Cleaners' }],
  };
  const failing = new Set<string>();

  const uniqueViolation = (table: string, row: Row): boolean => {
    if (table !== 'accountant_access') return false;
    return tables.accountant_access.some(
      (r) =>
        r.link_token_hash === row.link_token_hash ||
        (r.status === 'active' && r.tenant_id === row.tenant_id && r.email === row.email),
    );
  };

  function builder(table: string) {
    let mode: 'select' | 'insert' | 'update' = 'select';
    let values: Row = {};
    let head = false;
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    const preds: Pred[] = [];
    const b: Record<string, unknown> = {};

    const run = (): { data?: unknown; count?: number | null; error: { code?: string; message: string } | null } => {
      if (failing.has(table)) return { data: null, count: null, error: { code: 'XX000', message: 'boom' } };
      if (mode === 'insert') {
        const row: Row = { ...values, created_at: new Date().toISOString() };
        if (uniqueViolation(table, row)) return { error: { code: '23505', message: 'duplicate' } };
        if (table === 'accountant_access') Object.assign(row, { status: row.status ?? 'active', invited_at: row.created_at, last_viewed_at: null });
        if (table === 'accountant_login_codes') Object.assign(row, { attempts: 0, used_at: null });
        if (table === 'accountant_sessions') Object.assign(row, { last_seen_at: row.created_at, ended_at: null, id: row.id ?? crypto.randomUUID() });
        tables[table].push(row);
        return { error: null };
      }
      let hit = tables[table].filter((r) => preds.every((p) => p(r)));
      if (mode === 'update') {
        // Conditional updates: only rows still matching every filter change.
        hit.forEach((r) => Object.assign(r, values));
        return { data: hit.map((r) => ({ ...r })), error: null };
      }
      if (order) hit = [...hit].sort((x, y) => (String(x[order!.col]) < String(y[order!.col]) ? -1 : 1) * (order!.asc ? 1 : -1));
      if (limit != null) hit = hit.slice(0, limit);
      if (head) return { count: hit.length, error: null };
      return { data: hit.map((r) => ({ ...r })), error: null };
    };

    const add = (fn: Pred) => { preds.push(fn); return b; };
    b.select = (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return b; };
    b.insert = (v: Row) => { mode = 'insert'; values = v; return b; };
    b.update = (v: Row) => { mode = 'update'; values = v; return b; };
    b.eq = (k: string, v: unknown) => add((r) => r[k] === v);
    b.is = (k: string, v: unknown) => add((r) => (r[k] ?? null) === v);
    b.gt = (k: string, v: unknown) => add((r) => String(r[k]) > String(v));
    b.gte = (k: string, v: unknown) => add((r) => String(r[k]) >= String(v));
    b.lt = (k: string, v: unknown) => add((r) => (typeof v === 'number' ? Number(r[k]) < v : String(r[k]) < String(v)));
    b.order = (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending !== false }; return b; };
    b.limit = (n: number) => { limit = n; return b; };
    b.maybeSingle = async () => {
      const r = run();
      const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data ?? null;
      return { data, error: r.error };
    };
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject);
    return b;
  }

  return { db: { from: (t: string) => builder(t) } as unknown as SupabaseClient, tables, failing };
}

const SECRET = 'a-test-secret';
let env: string | undefined;
beforeEach(() => {
  env = process.env.ACCOUNTANT_CODE_SECRET;
  process.env.ACCOUNTANT_CODE_SECRET = SECRET;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  if (env === undefined) delete process.env.ACCOUNTANT_CODE_SECRET;
  else process.env.ACCOUNTANT_CODE_SECRET = env;
  vi.restoreAllMocks();
});

async function invited(f = fakeDb(), email = 'Accountant@Example.com') {
  const r = await inviteAccountant(f.db, { tenantId: 't1', userId: 'u1', email, name: ' Pat ' });
  if (!r.ok) throw new Error(r.error);
  return { ...f, accessId: r.accessId, link: r.linkToken };
}

async function signedIn(f = fakeDb()) {
  const inv = await invited(f);
  const issued = await issueLoginCode(inv.db, inv.link);
  if (!issued.ok) throw new Error(issued.error);
  const verified = await verifyLoginCode(inv.db, { linkToken: inv.link, code: issued.code });
  if (!verified.ok) throw new Error(verified.error);
  return { ...inv, session: verified.sessionToken, code: issued.code };
}

describe('inviteAccountant', () => {
  it('lower-cases the email, stores only a hash of the link, and returns the raw link once', async () => {
    const { tables, link, accessId } = await invited();
    const row = tables.accountant_access[0];
    expect(row).toMatchObject({ id: accessId, tenant_id: 't1', email: 'accountant@example.com', name: 'Pat', invited_by_user_id: 'u1' });
    expect(JSON.stringify(tables)).not.toContain(link);
    expect(row.link_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a bad email with the exact message', async () => {
    const f = fakeDb();
    for (const email of ['', 'nope', 'a@', '@b.com', 'two words@x.com']) {
      expect(await inviteAccountant(f.db, { tenantId: 't1', userId: null, email })).toEqual({
        ok: false, error: 'Enter a valid email address.',
      });
    }
    expect(f.tables.accountant_access).toHaveLength(0);
  });

  it('refuses a second active invite for the same email, but allows it after removal', async () => {
    const f = await invited();
    expect(await inviteAccountant(f.db, { tenantId: 't1', userId: null, email: 'accountant@example.com' })).toEqual({
      ok: false, error: 'That accountant already has access.',
    });
    // The same accountant can work for a different business.
    expect((await inviteAccountant(f.db, { tenantId: 't2', userId: null, email: 'accountant@example.com' })).ok).toBe(true);
    await removeAccountant(f.db, { tenantId: 't1', accessId: f.accessId, userId: 'u1' });
    expect((await inviteAccountant(f.db, { tenantId: 't1', userId: null, email: 'accountant@example.com' })).ok).toBe(true);
  });

  it('fails plainly on a database error', async () => {
    const f = fakeDb();
    f.failing.add('accountant_access');
    expect(await inviteAccountant(f.db, { tenantId: 't1', userId: null, email: 'a@b.com' })).toEqual({
      ok: false, error: "Couldn't do that. Try again.",
    });
  });
});

describe('listAccess / resendInvite', () => {
  it('lists active accountants of this business only', async () => {
    const f = await invited();
    await inviteAccountant(f.db, { tenantId: 't2', userId: null, email: 'other@x.com' });
    const gone = await inviteAccountant(f.db, { tenantId: 't1', userId: null, email: 'gone@x.com' });
    if (gone.ok) await removeAccountant(f.db, { tenantId: 't1', accessId: gone.accessId, userId: null });
    const list = await listAccess(f.db, 't1');
    expect(list.map((a) => a.email)).toEqual(['accountant@example.com']);
    expect(list[0]).toMatchObject({ name: 'Pat', lastViewedAt: null });
  });

  it('rotates the link: the old one stops working and the new one works', async () => {
    const f = await invited();
    const re = await resendInvite(f.db, { tenantId: 't1', accessId: f.accessId });
    if (!re.ok) throw new Error(re.error);
    expect(re.linkToken).not.toBe(f.link);
    expect(re.email).toBe('accountant@example.com');
    expect(await issueLoginCode(f.db, f.link)).toEqual({ ok: false, error: 'not_found' });
    expect((await issueLoginCode(f.db, re.linkToken)).ok).toBe(true);
  });

  it("will not resend another business's accountant, or a removed one", async () => {
    const f = await invited();
    expect(await resendInvite(f.db, { tenantId: 't2', accessId: f.accessId })).toEqual({
      ok: false, error: 'That accountant no longer has access.',
    });
    await removeAccountant(f.db, { tenantId: 't1', accessId: f.accessId, userId: null });
    expect((await resendInvite(f.db, { tenantId: 't1', accessId: f.accessId })).ok).toBe(false);
  });
});

describe('removeAccountant', () => {
  it('ends every session and stops the very next page load', async () => {
    const f = await signedIn();
    expect(await loadAccountantContext(f.db, { linkToken: f.link, sessionToken: f.session })).not.toBeNull();
    expect(await removeAccountant(f.db, { tenantId: 't1', accessId: f.accessId, userId: 'u1' })).toEqual({ ok: true });
    expect(f.tables.accountant_sessions.every((s) => s.ended_at)).toBe(true);
    expect(f.tables.accountant_access[0]).toMatchObject({ status: 'removed', removed_by_user_id: 'u1' });
    expect(await loadAccountantContext(f.db, { linkToken: f.link, sessionToken: f.session })).toBeNull();
    expect(await issueLoginCode(f.db, f.link)).toEqual({ ok: false, error: 'not_found' });
  });

  it('cuts access off even if ending the sessions fails', async () => {
    const f = await signedIn();
    f.failing.add('accountant_sessions');
    expect((await removeAccountant(f.db, { tenantId: 't1', accessId: f.accessId, userId: null })).ok).toBe(true);
    f.failing.delete('accountant_sessions');
    expect(await loadAccountantContext(f.db, { linkToken: f.link, sessionToken: f.session })).toBeNull();
  });

  it("cannot remove another business's accountant, and says so for one already removed", async () => {
    const f = await invited();
    expect(await removeAccountant(f.db, { tenantId: 't2', accessId: f.accessId, userId: null })).toEqual({
      ok: false, error: 'That accountant no longer has access.',
    });
    expect(f.tables.accountant_access[0].status).toBe('active');
    await removeAccountant(f.db, { tenantId: 't1', accessId: f.accessId, userId: null });
    expect(await removeAccountant(f.db, { tenantId: 't1', accessId: f.accessId, userId: null })).toEqual({
      ok: false, error: 'That accountant no longer has access.',
    });
  });
});

describe('issueLoginCode', () => {
  it('returns the raw code once, and stores only a keyed hash that expires in 10 minutes', async () => {
    const f = await invited();
    const r = await issueLoginCode(f.db, f.link);
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ accessId: f.accessId, email: 'accountant@example.com', businessName: 'Bright Windows' });
    expect(r.code).toMatch(/^\d{6}$/);
    const stored = f.tables.accountant_login_codes[0];
    expect(JSON.stringify(stored)).not.toContain(r.code);
    expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/);
    const minutes = (new Date(String(stored.expires_at)).getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(9.5);
    expect(minutes).toBeLessThanOrEqual(10);
  });

  it('says not_found for a malformed, unknown or removed link without touching the database', async () => {
    const f = fakeDb();
    f.failing.add('accountant_access');
    expect(await issueLoginCode(f.db, 'nope')).toEqual({ ok: false, error: 'not_found' });
    expect(await issueLoginCode(f.db, 'a'.repeat(43))).toMatchObject({ ok: false });
  });

  it('allows five codes an hour and refuses the sixth', async () => {
    const f = await invited();
    for (let i = 0; i < 5; i += 1) expect((await issueLoginCode(f.db, f.link)).ok).toBe(true);
    expect(await issueLoginCode(f.db, f.link)).toEqual({ ok: false, error: 'too_many' });
    // An older code does not count against the hour.
    f.tables.accountant_login_codes.forEach((c) => { c.created_at = new Date(Date.now() - 2 * 3_600_000).toISOString(); });
    expect((await issueLoginCode(f.db, f.link)).ok).toBe(true);
  });

  it('fails (and logs) when the secret is missing, and never makes an unkeyed code', async () => {
    const f = await invited();
    delete process.env.ACCOUNTANT_CODE_SECRET;
    expect(await issueLoginCode(f.db, f.link)).toEqual({ ok: false, error: 'failed' });
    expect(f.tables.accountant_login_codes).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith('[accountant:issueLoginCode] ACCOUNTANT_CODE_SECRET not set');
  });

  it('fails closed on a database error', async () => {
    const f = await invited();
    f.failing.add('accountant_login_codes');
    expect(await issueLoginCode(f.db, f.link)).toEqual({ ok: false, error: 'failed' });
  });
});

describe('verifyLoginCode', () => {
  it('starts a 30-day session and records the view', async () => {
    const f = await invited();
    const issued = await issueLoginCode(f.db, f.link);
    if (!issued.ok) throw new Error();
    const r = await verifyLoginCode(f.db, { linkToken: f.link, code: issued.code });
    if (!r.ok) throw new Error(r.error);
    const hours = (new Date(r.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(719.9);
    expect(hours).toBeLessThanOrEqual(720);
    expect(JSON.stringify(f.tables.accountant_sessions)).not.toContain(r.sessionToken);
    expect(f.tables.accountant_access[0].last_viewed_at).toBeTruthy();
  });

  it('says wrong_code for a wrong one and counts the try', async () => {
    const f = await invited();
    const issued = await issueLoginCode(f.db, f.link);
    if (!issued.ok) throw new Error();
    const wrong = issued.code === '000000' ? '000001' : '000000';
    expect(await verifyLoginCode(f.db, { linkToken: f.link, code: wrong })).toEqual({ ok: false, error: 'wrong_code' });
    expect(f.tables.accountant_login_codes[0].attempts).toBe(1);
    expect((await verifyLoginCode(f.db, { linkToken: f.link, code: issued.code })).ok).toBe(true);
  });

  it('after five wrong tries even the right code is expired', async () => {
    const f = await invited();
    const issued = await issueLoginCode(f.db, f.link);
    if (!issued.ok) throw new Error();
    const wrong = issued.code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i += 1) {
      expect(await verifyLoginCode(f.db, { linkToken: f.link, code: wrong })).toEqual({ ok: false, error: 'wrong_code' });
    }
    expect(await verifyLoginCode(f.db, { linkToken: f.link, code: issued.code })).toEqual({ ok: false, error: 'expired' });
    expect(f.tables.accountant_login_codes[0].attempts).toBe(5);
    expect(f.tables.accountant_sessions).toHaveLength(0);
  });

  it('lets a code be used once only', async () => {
    const f = await invited();
    const issued = await issueLoginCode(f.db, f.link);
    if (!issued.ok) throw new Error();
    expect((await verifyLoginCode(f.db, { linkToken: f.link, code: issued.code })).ok).toBe(true);
    expect(await verifyLoginCode(f.db, { linkToken: f.link, code: issued.code })).toEqual({ ok: false, error: 'expired' });
    expect(f.tables.accountant_sessions).toHaveLength(1);
  });

  it('treats an expired code as expired', async () => {
    const f = await invited();
    const issued = await issueLoginCode(f.db, f.link);
    if (!issued.ok) throw new Error();
    f.tables.accountant_login_codes[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await verifyLoginCode(f.db, { linkToken: f.link, code: issued.code })).toEqual({ ok: false, error: 'expired' });
  });

  it('only the newest code works: asking for another replaces the last', async () => {
    const f = await invited();
    const first = await issueLoginCode(f.db, f.link);
    // Make sure the second really is newer.
    f.tables.accountant_login_codes[0].created_at = new Date(Date.now() - 5000).toISOString();
    const second = await issueLoginCode(f.db, f.link);
    if (!first.ok || !second.ok) throw new Error();
    if (first.code !== second.code) {
      expect(await verifyLoginCode(f.db, { linkToken: f.link, code: first.code })).toEqual({ ok: false, error: 'wrong_code' });
    }
    expect((await verifyLoginCode(f.db, { linkToken: f.link, code: second.code })).ok).toBe(true);
  });

  it("will not accept a code issued for another accountant's link", async () => {
    const a = await invited();
    const b = await inviteAccountant(a.db, { tenantId: 't2', userId: null, email: 'b@x.com' });
    if (!b.ok) throw new Error();
    const issuedA = await issueLoginCode(a.db, a.link);
    const issuedB = await issueLoginCode(a.db, b.linkToken);
    if (!issuedA.ok || !issuedB.ok) throw new Error();
    // B's code against A's link: A's newest code is A's, so it just fails.
    if (issuedA.code !== issuedB.code) {
      expect(await verifyLoginCode(a.db, { linkToken: a.link, code: issuedB.code })).toEqual({ ok: false, error: 'wrong_code' });
    }
  });

  it('refuses anything that is not six digits without spending a try', async () => {
    const f = await invited();
    await issueLoginCode(f.db, f.link);
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', "' or 1=1"]) {
      expect(await verifyLoginCode(f.db, { linkToken: f.link, code: bad })).toEqual({ ok: false, error: 'wrong_code' });
    }
    expect(f.tables.accountant_login_codes[0].attempts).toBe(0);
  });

  it('says not_found for an unknown or removed link, and failed without the secret', async () => {
    const f = await invited();
    const issued = await issueLoginCode(f.db, f.link);
    if (!issued.ok) throw new Error();
    expect(await verifyLoginCode(f.db, { linkToken: 'x'.repeat(43), code: issued.code })).toEqual({ ok: false, error: 'not_found' });
    delete process.env.ACCOUNTANT_CODE_SECRET;
    expect(await verifyLoginCode(f.db, { linkToken: f.link, code: issued.code })).toEqual({ ok: false, error: 'failed' });
    process.env.ACCOUNTANT_CODE_SECRET = SECRET;
    await removeAccountant(f.db, { tenantId: 't1', accessId: f.accessId, userId: null });
    expect(await verifyLoginCode(f.db, { linkToken: f.link, code: issued.code })).toEqual({ ok: false, error: 'not_found' });
  });

  it('does not accept a code made under a different secret', async () => {
    const f = await invited();
    const issued = await issueLoginCode(f.db, f.link);
    if (!issued.ok) throw new Error();
    process.env.ACCOUNTANT_CODE_SECRET = 'changed-secret';
    expect(await verifyLoginCode(f.db, { linkToken: f.link, code: issued.code })).toEqual({ ok: false, error: 'wrong_code' });
  });
});

describe('loadAccountantContext', () => {
  it('gives the business of the access row, never anything from the caller', async () => {
    const f = await signedIn();
    expect(await loadAccountantContext(f.db, { linkToken: f.link, sessionToken: f.session })).toEqual({
      accessId: f.accessId, tenantId: 't1', email: 'accountant@example.com', businessName: 'Bright Windows',
    });
  });

  it('is null with no session, a malformed one, or an unknown one', async () => {
    const f = await signedIn();
    for (const sessionToken of [undefined, '', 'short', 'a'.repeat(43)]) {
      expect(await loadAccountantContext(f.db, { linkToken: f.link, sessionToken })).toBeNull();
    }
  });

  it('is null once the 30 days are up, or after sign-out', async () => {
    const f = await signedIn();
    f.tables.accountant_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await loadAccountantContext(f.db, { linkToken: f.link, sessionToken: f.session })).toBeNull();

    const g = await signedIn();
    await endSession(g.db, g.session);
    expect(await loadAccountantContext(g.db, { linkToken: g.link, sessionToken: g.session })).toBeNull();
  });

  it("will not let one accountant's session open another accountant's link", async () => {
    const a = await signedIn();
    const b = await inviteAccountant(a.db, { tenantId: 't2', userId: null, email: 'b@x.com' });
    if (!b.ok) throw new Error();
    expect(await loadAccountantContext(a.db, { linkToken: b.linkToken, sessionToken: a.session })).toBeNull();
  });

  it('is null after a link rotation, and null on any database error', async () => {
    const f = await signedIn();
    const re = await resendInvite(f.db, { tenantId: 't1', accessId: f.accessId });
    if (!re.ok) throw new Error();
    expect(await loadAccountantContext(f.db, { linkToken: f.link, sessionToken: f.session })).toBeNull();
    expect(await loadAccountantContext(f.db, { linkToken: re.linkToken, sessionToken: f.session })).not.toBeNull();
    f.failing.add('accountant_sessions');
    expect(await loadAccountantContext(f.db, { linkToken: re.linkToken, sessionToken: f.session })).toBeNull();
  });

  it('records "last viewed" at most once every five minutes', async () => {
    const f = await signedIn();
    const before = f.tables.accountant_sessions[0].last_seen_at;
    await loadAccountantContext(f.db, { linkToken: f.link, sessionToken: f.session });
    expect(f.tables.accountant_sessions[0].last_seen_at).toBe(before);
    f.tables.accountant_sessions[0].last_seen_at = new Date(Date.now() - 6 * 60_000).toISOString();
    await loadAccountantContext(f.db, { linkToken: f.link, sessionToken: f.session });
    expect(new Date(String(f.tables.accountant_sessions[0].last_seen_at)).getTime()).toBeGreaterThan(Date.now() - 5000);
  });
});

describe('logging', () => {
  it('never writes a link token, code, session token or email to the log', async () => {
    const f = await invited();
    const issued = await issueLoginCode(f.db, f.link);
    if (!issued.ok) throw new Error();
    f.failing.add('accountant_login_codes');
    await verifyLoginCode(f.db, { linkToken: f.link, code: issued.code });
    await issueLoginCode(f.db, f.link);
    const logged = JSON.stringify((console.error as ReturnType<typeof vi.fn>).mock.calls);
    for (const secret of [f.link, issued.code, 'accountant@example.com']) {
      expect(logged).not.toContain(secret);
    }
  });
});
