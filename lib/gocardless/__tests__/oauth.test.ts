import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptToken, encryptToken, sha256Hex } from '@/lib/gocardless/crypto';
import {
  completeGoCardlessConnect,
  disconnectGoCardless,
  startGoCardlessConnect,
} from '@/lib/gocardless/oauth';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const NEW_TOKEN = 'sandbox_new_access_token';
const CODE = 'auth-code-123';

type Row = Record<string, unknown>;

/** Just enough of the admin client for gocardless_connections. */
function fakeAdmin(rows: Row[]): SupabaseClient {
  const from = (table: string) => {
    if (table !== 'gocardless_connections') throw new Error(`unexpected table ${table}`);
    let op: 'select' | 'update' | 'upsert' = 'select';
    let payload: Row = {};
    let columns = '';
    const filters: [string, unknown][] = [];

    const finish = async (single: boolean) => {
      if (op === 'upsert') {
        const existing = rows.find((r) => r.tenant_id === payload.tenant_id);
        if (existing) Object.assign(existing, payload);
        else rows.push({ id: `c${rows.length + 1}`, status: 'not_connected', ...payload });
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => filters.every(([col, val]) => r[col] === val));
      if (op === 'update') {
        if (
          payload.status === 'connected' &&
          rows.some(
            (r) =>
              r !== hit[0] &&
              r.status === 'connected' &&
              r.organisation_id === payload.organisation_id,
          )
        ) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        for (const r of hit) Object.assign(r, payload);
      }
      const pick = (r: Row) => {
        const out: Row = {};
        for (const c of columns.split(',').map((x) => x.trim()).filter(Boolean)) out[c] = r[c];
        return out;
      };
      const data = columns ? hit.map(pick) : null;
      return { data: single ? (data?.[0] ?? null) : data, error: null };
    };

    const builder = {
      select(cols: string) {
        columns = cols;
        return builder;
      },
      update(row: Row) {
        op = 'update';
        payload = row;
        return builder;
      },
      upsert(row: Row) {
        op = 'upsert';
        payload = row;
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return builder;
      },
      maybeSingle() {
        return finish(true);
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return finish(false).then(resolve, reject);
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

const fetchMock = vi.fn<typeof fetch>();
let tokenKey: Buffer;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function callsTo(path: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(path));
}

function formOf(call: Parameters<typeof fetch>): URLSearchParams {
  return new URLSearchParams(String(call[1]?.body));
}

/** GoCardless: code exchange, creditors, revoke. */
function gocardlessAnswers(opts: { exchange?: Response; verification?: string } = {}) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/oauth/access_token')) {
      return (
        opts.exchange ??
        json(200, {
          access_token: NEW_TOKEN,
          organisation_id: 'OR_NEW',
          email: 'owner@example.test',
          scope: 'read_write',
          token_type: 'bearer',
        })
      );
    }
    if (url.includes('/creditors')) {
      return json(200, {
        creditors: [{ id: 'CR1', verification_status: opts.verification ?? 'action_required' }],
      });
    }
    if (url.endsWith('/oauth/revoke')) return json(200, {});
    return json(404, {});
  });
}

beforeEach(() => {
  tokenKey = randomBytes(32);
  process.env.GOCARDLESS_ENVIRONMENT = 'sandbox';
  process.env.GOCARDLESS_CLIENT_ID = 'client-id';
  process.env.GOCARDLESS_CLIENT_SECRET = 'client-secret';
  process.env.GOCARDLESS_WEBHOOK_SECRET = 'webhook-secret';
  process.env.GOCARDLESS_TOKEN_KEY = tokenKey.toString('base64');
  process.env.GOCARDLESS_REDIRECT_URI = 'https://example.test/api/gocardless/callback';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const now = new Date('2026-09-30T12:00:00.000Z');
const prefill = {
  email: 'owner@example.test',
  givenName: 'Sam',
  familyName: 'Taylor Smith',
  businessName: 'Sparkle Windows',
};

async function started(rows: Row[], extra: Partial<Parameters<typeof startGoCardlessConnect>[1]> = {}) {
  const url = new URL(
    await startGoCardlessConnect(fakeAdmin(rows), {
      tenantId: TENANT,
      from: 'web',
      hasAccount: false,
      prefill,
      now,
      ...extra,
    }),
  );
  return { url, state: url.searchParams.get('state')! };
}

describe('startGoCardlessConnect', () => {
  it('builds the sign-up authorise URL and stores only the state hash', async () => {
    const rows: Row[] = [];
    const { url, state } = await started(rows);
    expect(url.origin + url.pathname).toBe('https://connect-sandbox.gocardless.com/oauth/authorize');
    const q = url.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe('client-id');
    expect(q.get('scope')).toBe('read_write');
    expect(q.get('redirect_uri')).toBe('https://example.test/api/gocardless/callback');
    expect(q.get('initial_view')).toBe('signup');
    expect(q.get('prefill[email]')).toBe('owner@example.test');
    expect(q.get('prefill[given_name]')).toBe('Sam');
    expect(q.get('prefill[family_name]')).toBe('Taylor Smith');
    expect(q.get('prefill[organisation_name]')).toBe('Sparkle Windows');
    expect(q.get('prefill[country_code]')).toBe('GB');
    expect(Buffer.from(state, 'base64url')).toHaveLength(32);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT,
      status: 'not_connected',
      oauth_state_hash: sha256Hex(state),
      oauth_state_expires_at: '2026-09-30T12:30:00.000Z',
      oauth_from: 'web',
    });
    expect(JSON.stringify(rows)).not.toContain(state);
  });

  it('login view for an existing account, empty prefill left out, status untouched', async () => {
    const rows: Row[] = [{ id: 'c1', tenant_id: TENANT, status: 'disconnected' }];
    const { url } = await started(rows, {
      hasAccount: true,
      from: 'app',
      prefill: { email: null, givenName: null, familyName: null, businessName: 'Sparkle Windows' },
    });
    expect(url.searchParams.get('initial_view')).toBe('login');
    expect(url.searchParams.has('prefill[email]')).toBe(false);
    expect(url.searchParams.has('prefill[given_name]')).toBe(false);
    expect(rows[0]).toMatchObject({ status: 'disconnected', oauth_from: 'app' });
  });
});

describe('completeGoCardlessConnect', () => {
  it('happy path: token encrypted, state cleared, verification read', async () => {
    const rows: Row[] = [];
    const { state } = await started(rows);
    gocardlessAnswers();

    const result = await completeGoCardlessConnect(fakeAdmin(rows), {
      state,
      code: CODE,
      error: null,
      now: new Date(now.getTime() + 60_000),
    });
    expect(result).toEqual({ outcome: 'connected', from: 'web', tenantId: TENANT });

    const row = rows[0];
    expect(row).toMatchObject({
      status: 'connected',
      organisation_id: 'OR_NEW',
      connected_email: 'owner@example.test',
      oauth_state_hash: null,
      oauth_state_expires_at: null,
      oauth_from: null,
      creditor_id: 'CR1',
      verification_status: 'action_required',
    });
    expect(row.access_token_enc).not.toContain(NEW_TOKEN);
    expect(decryptToken(String(row.access_token_enc), tokenKey)).toBe(NEW_TOKEN);

    const exchange = callsTo('/oauth/access_token');
    expect(exchange).toHaveLength(1);
    expect(String(exchange[0][0])).toBe('https://connect-sandbox.gocardless.com/oauth/access_token');
    expect(Object.fromEntries(formOf(exchange[0]))).toEqual({
      grant_type: 'authorization_code',
      code: CODE,
      redirect_uri: 'https://example.test/api/gocardless/callback',
      client_id: 'client-id',
      client_secret: 'client-secret',
    });
    expect(callsTo('/creditors')).toHaveLength(1);
  });

  it('the same link a second time → error, nothing changes', async () => {
    const rows: Row[] = [];
    const { state } = await started(rows);
    gocardlessAnswers();
    await completeGoCardlessConnect(fakeAdmin(rows), { state, code: CODE, error: null, now });
    const before = JSON.stringify(rows);
    fetchMock.mockClear();
    const again = await completeGoCardlessConnect(fakeAdmin(rows), { state, code: CODE, error: null, now });
    expect(again).toEqual({ outcome: 'error', from: 'web', tenantId: null });
    expect(JSON.stringify(rows)).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('after 30 minutes → expired, nothing stored', async () => {
    const rows: Row[] = [];
    const { state } = await started(rows, { from: 'app' });
    gocardlessAnswers();
    const result = await completeGoCardlessConnect(fakeAdmin(rows), {
      state,
      code: CODE,
      error: null,
      now: new Date(now.getTime() + 31 * 60_000),
    });
    expect(result).toEqual({ outcome: 'expired', from: 'app', tenantId: TENANT });
    expect(rows[0]).toMatchObject({ status: 'not_connected', oauth_state_hash: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('access_denied → cancelled', async () => {
    const rows: Row[] = [];
    const { state } = await started(rows);
    const result = await completeGoCardlessConnect(fakeAdmin(rows), {
      state,
      code: null,
      error: 'access_denied',
      now,
    });
    expect(result.outcome).toBe('cancelled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bad or missing state → error', async () => {
    const rows: Row[] = [];
    await started(rows);
    expect(
      await completeGoCardlessConnect(fakeAdmin(rows), { state: 'nope', code: CODE, error: null, now }),
    ).toEqual({ outcome: 'error', from: 'web', tenantId: null });
    expect(
      await completeGoCardlessConnect(fakeAdmin(rows), { state: null, code: CODE, error: null, now }),
    ).toEqual({ outcome: 'error', from: 'web', tenantId: null });
    expect(rows[0].oauth_state_hash).not.toBeNull();
  });

  it('a pressed-twice Connect: the first tab comes back error', async () => {
    const rows: Row[] = [];
    const first = await started(rows);
    const second = await started(rows);
    gocardlessAnswers();
    const stale = await completeGoCardlessConnect(fakeAdmin(rows), {
      state: first.state,
      code: CODE,
      error: null,
      now,
    });
    expect(stale.outcome).toBe('error');
    const fresh = await completeGoCardlessConnect(fakeAdmin(rows), {
      state: second.state,
      code: CODE,
      error: null,
      now,
    });
    expect(fresh.outcome).toBe('connected');
  });

  it('code exchange failure → error, nothing stored, code not logged', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rows: Row[] = [];
    const { state } = await started(rows);
    gocardlessAnswers({ exchange: json(400, { error: 'invalid_grant', error_description: 'bad code' }) });
    const result = await completeGoCardlessConnect(fakeAdmin(rows), { state, code: CODE, error: null, now });
    expect(result).toEqual({ outcome: 'error', from: 'web', tenantId: TENANT });
    expect(rows[0].status).toBe('not_connected');
    expect(rows[0].access_token_enc).toBeUndefined();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(CODE);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(state);
    errorLog.mockRestore();
  });

  it('an organisation connected to another business → taken, new token revoked, other untouched', async () => {
    const otherEnc = encryptToken('other_token', tokenKey);
    const rows: Row[] = [
      {
        id: 'c-other',
        tenant_id: OTHER_TENANT,
        status: 'connected',
        organisation_id: 'OR_NEW',
        access_token_enc: otherEnc,
      },
    ];
    const { state } = await started(rows);
    gocardlessAnswers();
    const result = await completeGoCardlessConnect(fakeAdmin(rows), { state, code: CODE, error: null, now });
    expect(result).toEqual({ outcome: 'taken', from: 'web', tenantId: TENANT });

    const revoke = callsTo('/oauth/revoke');
    expect(revoke).toHaveLength(1);
    expect(formOf(revoke[0]).get('token')).toBe(NEW_TOKEN);
    expect(rows.find((r) => r.tenant_id === OTHER_TENANT)).toMatchObject({
      status: 'connected',
      access_token_enc: otherEnc,
    });
    expect(rows.find((r) => r.tenant_id === TENANT)).toMatchObject({ status: 'not_connected' });
  });

  it('reconnecting the same organisation is fine', async () => {
    const rows: Row[] = [
      {
        id: 'c1',
        tenant_id: TENANT,
        status: 'disconnected',
        organisation_id: 'OR_NEW',
        disconnect_reason: 'Disconnected in WorkWise',
        access_token_enc: null,
      },
    ];
    const { state } = await started(rows);
    gocardlessAnswers({ verification: 'successful' });
    const result = await completeGoCardlessConnect(fakeAdmin(rows), { state, code: CODE, error: null, now });
    expect(result.outcome).toBe('connected');
    expect(rows[0]).toMatchObject({
      status: 'connected',
      disconnect_reason: null,
      disconnected_at: null,
      verification_status: 'successful',
    });
  });
});

describe('disconnectGoCardless', () => {
  function connected(): Row[] {
    return [
      {
        id: 'c1',
        tenant_id: TENANT,
        status: 'connected',
        organisation_id: 'OR1',
        access_token_enc: encryptToken('live_token_1', tokenKey),
      },
    ];
  }

  it('revokes the token, then disconnects and forgets it', async () => {
    gocardlessAnswers();
    const rows = connected();
    await disconnectGoCardless(fakeAdmin(rows), { tenantId: TENANT });
    const revoke = callsTo('/oauth/revoke');
    expect(revoke).toHaveLength(1);
    expect(String(revoke[0][0])).toBe('https://connect-sandbox.gocardless.com/oauth/revoke');
    expect(Object.fromEntries(formOf(revoke[0]))).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      token: 'live_token_1',
    });
    expect(rows[0]).toMatchObject({
      status: 'disconnected',
      disconnect_reason: 'Disconnected in WorkWise',
      access_token_enc: null,
    });
  });

  it('still disconnects when the revoke call fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const rows = connected();
    await disconnectGoCardless(fakeAdmin(rows), { tenantId: TENANT });
    expect(rows[0]).toMatchObject({ status: 'disconnected', access_token_enc: null });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('live_token_1');
    errorLog.mockRestore();
  });
});
