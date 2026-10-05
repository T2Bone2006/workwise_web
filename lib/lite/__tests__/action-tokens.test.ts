import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { LINK_TOKEN_RE, sha256Hex } from '@/lib/accountant/tokens';
import { issueLeadToken, resolveLeadToken, touchLeadToken } from '@/lib/lite/action-tokens';

type Rec = Record<string, unknown>;

const state = {
  tokens: [] as Rec[],
  insertError: false,
  queryError: false,
  updateError: false,
  queries: 0,
};

function builder() {
  const filters: Array<(row: Rec) => boolean> = [];
  let mode: 'select' | 'insert' | 'update' = 'select';
  let patch: Rec | null = null;
  let incoming: Rec | null = null;

  function execute(single: boolean) {
    state.queries += 1;
    if (mode === 'insert') {
      if (state.insertError) return { data: null, error: { message: 'down' } };
      const row = { id: 'token-1', ...(incoming ?? {}) };
      state.tokens.push(row);
      return { data: single ? row : [row], error: null };
    }
    if (state.queryError && mode === 'select') return { data: null, error: { message: 'down' } };
    if (mode === 'update' && state.updateError) return { data: null, error: { message: 'down' } };
    const hit = state.tokens.filter((row) => filters.every((pred) => pred(row)));
    if (mode === 'update') {
      for (const row of hit) Object.assign(row, patch);
    }
    const copies = hit.map((row) => ({ ...row }));
    return { data: single ? (copies[0] ?? null) : copies, error: null };
  }

  const api = {
    select: () => api,
    eq: (key: string, value: unknown) => {
      filters.push((row) => row[key] === value);
      return api;
    },
    insert: (row: Rec) => {
      mode = 'insert';
      incoming = row;
      return api;
    },
    update: (next: Rec) => {
      mode = 'update';
      patch = next;
      return api;
    },
    maybeSingle: async () => execute(true),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(execute(false)).then(resolve, reject),
  };
  return api;
}

const admin = { from: () => builder() } as unknown as SupabaseClient;
const now = new Date('2026-06-01T00:00:00.000Z');

describe('lead action tokens', () => {
  it('stores only the hash and returns the raw token', async () => {
    state.tokens.length = 0;
    state.insertError = false;
    const raw = await issueLeadToken(admin, { tenantId: 'tenant-1', leadId: 'lead-1', now });
    expect(raw).toMatch(LINK_TOKEN_RE);
    expect(state.tokens[0]).toMatchObject({
      tenant_id: 'tenant-1',
      lead_id: 'lead-1',
      token_hash: sha256Hex(raw ?? ''),
      expires_at: '2026-06-15T00:00:00.000Z',
    });
    expect(JSON.stringify(state.tokens[0])).not.toContain(raw);
  });

  it('returns null when the insert fails', async () => {
    state.insertError = true;
    await expect(issueLeadToken(admin, { tenantId: 'tenant-1', leadId: 'lead-1', now })).resolves.toBeNull();
    state.insertError = false;
  });

  it('rejects a short token without a database call', async () => {
    state.queries = 0;
    await expect(resolveLeadToken(admin, 'short', now)).resolves.toBe('invalid');
    expect(state.queries).toBe(0);
  });

  it('resolves a live token and reports an expired one', async () => {
    state.tokens.length = 0;
    state.queryError = false;
    const raw = await issueLeadToken(admin, { tenantId: 'tenant-1', leadId: 'lead-9', now });
    expect(await resolveLeadToken(admin, raw ?? '', now)).toEqual({
      tokenId: 'token-1',
      tenantId: 'tenant-1',
      leadId: 'lead-9',
    });
    state.tokens[0]!.expires_at = '2026-05-01T00:00:00.000Z';
    await expect(resolveLeadToken(admin, raw ?? '', now)).resolves.toBe('expired');
  });

  it('returns invalid when the hash is unknown and error when the query fails', async () => {
    state.tokens.length = 0;
    const raw = 'a'.repeat(43);
    await expect(resolveLeadToken(admin, raw, now)).resolves.toBe('invalid');
    state.queryError = true;
    await expect(resolveLeadToken(admin, raw, now)).resolves.toBe('error');
    state.queryError = false;
  });

  it('stamps last_used_at and ignores a failed stamp', async () => {
    state.tokens.length = 0;
    state.updateError = false;
    state.tokens.push({ id: 'token-1', token_hash: 'abc' });
    await touchLeadToken(admin, 'token-1');
    expect(typeof state.tokens[0]?.last_used_at).toBe('string');
    state.updateError = true;
    await expect(touchLeadToken(admin, 'token-1')).resolves.toBeUndefined();
    state.updateError = false;
  });
});
