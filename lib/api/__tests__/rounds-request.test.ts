import { beforeEach, describe, expect, it, vi } from 'vitest';

const createClientFromBearer = vi.fn();
const resolveTenantForUser = vi.fn();
const tenantHasRounds = vi.fn();
const admin = { tag: 'admin' };

vi.mock('@/lib/auth/bearer', () => ({
  createClientFromBearer: (request: Request) => createClientFromBearer(request),
  resolveTenantForUser: (...args: unknown[]) => resolveTenantForUser(...args),
}));
vi.mock('@/lib/messaging/rounds-tenants', () => ({
  tenantHasRounds: (...args: unknown[]) => tenantHasRounds(...args),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin,
}));

import { requireRoundsApi } from '@/lib/api/rounds-request';

function request(): Request {
  return new Request('http://localhost:3000/api/rounds/texts', {
    headers: { Authorization: 'Bearer token' },
  });
}

beforeEach(() => {
  createClientFromBearer.mockReset();
  resolveTenantForUser.mockReset();
  tenantHasRounds.mockReset();
  createClientFromBearer.mockResolvedValue({ supabase: { tag: 'sb' }, userId: 'user-1' });
  resolveTenantForUser.mockResolvedValue('tenant-1');
  tenantHasRounds.mockResolvedValue(true);
});

describe('requireRoundsApi', () => {
  it('refuses a bad token with 401 before checking the plan', async () => {
    createClientFromBearer.mockResolvedValue(null);
    const result = await requireRoundsApi(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(await result.response.json()).toEqual({ error: 'Unauthorised' });
    }
    expect(tenantHasRounds).not.toHaveBeenCalled();
  });

  it('returns 403 plan_ended when the business has no entitled Rounds plan', async () => {
    tenantHasRounds.mockResolvedValue(false);
    const result = await requireRoundsApi(request());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      expect(result.response.headers.get('Cache-Control')).toBe('no-store');
      expect(await result.response.json()).toEqual({ error: 'plan_ended' });
    }
    expect(tenantHasRounds).toHaveBeenCalledWith(admin, 'tenant-1');
  });

  it('lets a business with entitled Rounds through', async () => {
    const result = await requireRoundsApi(request());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ctx.tenantId).toBe('tenant-1');
  });
});
