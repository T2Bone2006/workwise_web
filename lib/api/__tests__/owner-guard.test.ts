import { describe, expect, it, vi } from 'vitest';

import { OWNER_ONLY_ERROR, callerIsOwner, ownerOnlyResponse } from '@/lib/api/owner-guard';

function clientReturning(result: { data?: unknown; error?: unknown } | 'throw') {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (result === 'throw') throw new Error('network');
            return { data: result.data ?? null, error: result.error ?? null };
          },
        }),
      }),
    }),
  } as never;
}

describe('callerIsOwner', () => {
  it('is true only for role admin', async () => {
    expect(await callerIsOwner(clientReturning({ data: { role: 'admin' } }), 'u1')).toBe(true);
  });

  it('is false for a member of staff (role worker)', async () => {
    expect(await callerIsOwner(clientReturning({ data: { role: 'worker' } }), 'u1')).toBe(false);
  });

  it('is false for a customer-portal login', async () => {
    expect(await callerIsOwner(clientReturning({ data: { role: 'customer_portal' } }), 'u1')).toBe(false);
  });

  it('is false when there is no users row', async () => {
    expect(await callerIsOwner(clientReturning({ data: null }), 'u1')).toBe(false);
  });

  it('is false when the read errors (fail safe)', async () => {
    expect(await callerIsOwner(clientReturning({ error: { message: 'boom' } }), 'u1')).toBe(false);
  });

  it('is false when the read throws (fail safe)', async () => {
    expect(await callerIsOwner(clientReturning('throw'), 'u1')).toBe(false);
  });
});

describe('ownerOnlyResponse', () => {
  it('is a no-store 403 with the exact error string the phone reads', async () => {
    const response = ownerOnlyResponse();
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: OWNER_ONLY_ERROR });
    expect(OWNER_ONLY_ERROR).toBe('owner_only');
  });
});

vi.mock('server-only', () => ({}));
