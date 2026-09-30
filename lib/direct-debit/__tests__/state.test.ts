import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { directDebitState, getDirectDebitState } from '@/lib/direct-debit/state';
import { encryptToken } from '@/lib/gocardless/crypto';
import { refreshVerification } from '@/lib/gocardless/connection';

const TENANT = '11111111-1111-1111-1111-111111111111';
const TOKEN = 'sandbox_test_token_value';

describe('directDebitState', () => {
  const cases: [Parameters<typeof directDebitState>[0], string][] = [
    [null, 'off'],
    [{ status: 'not_connected', verification_status: null }, 'off'],
    [{ status: 'disconnected', verification_status: 'successful' }, 'off'],
    [{ status: 'connected', verification_status: 'successful' }, 'on'],
    [{ status: 'connected', verification_status: 'action_required' }, 'needs_details'],
    [{ status: 'connected', verification_status: 'in_review' }, 'verifying'],
    [{ status: 'connected', verification_status: null }, 'verifying'],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(directDebitState(input)).toBe(expected);
    });
  }
});

type Row = Record<string, unknown>;

/** Just enough of the admin client for gocardless_connections. */
function fakeAdmin(rows: Row[]): SupabaseClient {
  const from = (table: string) => {
    if (table !== 'gocardless_connections') throw new Error(`unexpected table ${table}`);
    let op: 'select' | 'update' = 'select';
    let payload: Row = {};
    let columns = '';
    const filters: [string, unknown][] = [];

    const pick = (row: Row) => {
      const out: Row = {};
      for (const col of columns.split(',').map((c) => c.trim()).filter(Boolean)) out[col] = row[col];
      return out;
    };
    const finish = async (single: boolean) => {
      const hit = rows.filter((r) => filters.every(([col, val]) => r[col] === val));
      if (op === 'update') for (const r of hit) Object.assign(r, payload);
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

function connectedRow(extra: Row = {}): Row {
  return {
    id: 'conn-1',
    tenant_id: TENANT,
    status: 'connected',
    organisation_id: 'OR123',
    creditor_id: null,
    connected_email: 'owner@example.test',
    verification_status: 'in_review',
    verification_checked_at: null,
    mandates_checked_at: null,
    connected_at: '2026-09-30T09:00:00.000Z',
    disconnected_at: null,
    disconnect_reason: null,
    access_token_enc: encryptToken(TOKEN, tokenKey),
    ...extra,
  };
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

describe('getDirectDebitState', () => {
  it('reads the stored row (no API call); no row → off', async () => {
    expect(await getDirectDebitState(fakeAdmin([]), TENANT)).toBe('off');
    expect(
      await getDirectDebitState(fakeAdmin([connectedRow({ verification_status: 'successful' })]), TENANT),
    ).toBe('on');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('refreshVerification', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');

  it('a fresh check makes no API call', async () => {
    const rows = [connectedRow({ verification_checked_at: '2026-09-30T11:58:00.000Z' })];
    const row = await refreshVerification(fakeAdmin(rows), TENANT, { now });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row?.verification_status).toBe('in_review');
  });

  it('a stale check asks GoCardless and stores the answer', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ creditors: [{ id: 'CR9', verification_status: 'successful' }] }), {
        status: 200,
      }),
    );
    const rows = [connectedRow({ verification_checked_at: '2026-09-30T11:50:00.000Z' })];
    const row = await refreshVerification(fakeAdmin(rows), TENANT, { now });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api-sandbox.gocardless.com/creditors?limit=1');
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(row).toMatchObject({
      creditor_id: 'CR9',
      verification_status: 'successful',
      verification_checked_at: now.toISOString(),
    });
    expect(row && 'access_token_enc' in row).toBe(false);
    expect(directDebitState(row)).toBe('on');
  });

  it('force always asks, even when fresh', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ creditors: [{ id: 'CR9', verification_status: 'action_required' }] }), {
        status: 200,
      }),
    );
    const rows = [connectedRow({ verification_checked_at: '2026-09-30T11:59:00.000Z' })];
    const row = await refreshVerification(fakeAdmin(rows), TENANT, { now, force: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(directDebitState(row)).toBe('needs_details');
  });

  it('a revoked token disconnects the business (and forgets the token)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: 'Access token revoked',
            type: 'invalid_api_usage',
            code: 401,
            errors: [{ reason: 'access_token_revoked', message: 'Access token revoked' }],
          },
        }),
        { status: 401 },
      ),
    );
    const rows = [connectedRow()];
    const row = await refreshVerification(fakeAdmin(rows), TENANT, { now });
    expect(row).toMatchObject({
      status: 'disconnected',
      disconnect_reason: 'GoCardless access was removed',
    });
    expect(rows[0].access_token_enc).toBeNull();
    expect(directDebitState(row)).toBe('off');
  });

  it('other errors keep the stored row', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Internal error', type: 'gocardless', code: 500 } }), {
        status: 500,
      }),
    );
    const rows = [connectedRow()];
    const row = await refreshVerification(fakeAdmin(rows), TENANT, { now });
    expect(row).toMatchObject({ status: 'connected', verification_status: 'in_review' });
    expect(rows[0].verification_checked_at).toBeNull();
  });

  it('not connected → no API call', async () => {
    const rows = [connectedRow({ status: 'disconnected', access_token_enc: null })];
    const row = await refreshVerification(fakeAdmin(rows), TENANT, { now, force: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row?.status).toBe('disconnected');
  });
});
