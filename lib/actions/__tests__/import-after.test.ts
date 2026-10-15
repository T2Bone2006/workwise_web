import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = {
  tenantId: 'tenant-1' as string | null,
  hasRounds: true,
  userId: 'user-1' as string | null,
  admin: true,
  state: 'on' as 'off' | 'verifying' | 'needs_details' | 'on',
  history: { tenant_id: 'tenant-1', kind: 'rounds_customers' } as { tenant_id: string; kind: string | null } | null,
};

const refresh = vi.fn();

vi.mock('@/lib/data/tenant', () => ({ getTenantIdForCurrentUser: async () => session.tenantId }));
vi.mock('@/lib/data/tenant-products', () => ({ getTenantProducts: async () => ({ hasRounds: session.hasRounds }) }));
vi.mock('@/lib/stripe/connect', () => ({ isTenantAdmin: async () => session.admin }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: session.userId ? { id: session.userId } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: session.history, error: null }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/direct-debit/state', () => ({
  getDirectDebitState: async () => session.state,
}));
vi.mock('@/lib/direct-debit/existing', () => ({
  refreshMandateLinks: (...args: unknown[]) => refresh(...args),
}));

import { afterImport } from '@/lib/actions/rounds/import-after';

const OURS = '11111111-1111-4111-8111-111111111111';
const THEIRS = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  Object.assign(session, {
    tenantId: 'tenant-1',
    hasRounds: true,
    userId: 'user-1',
    admin: true,
    state: 'on',
    history: { tenant_id: 'tenant-1', kind: 'rounds_customers' },
  });
  refresh.mockReset();
  refresh.mockResolvedValue({ found: 1, autoLinked: 1, probable: 0, unmatched: 0, otherApp: 0 });
});

describe('afterImport', () => {
  it('refuses an import that is not this business or not a rounds import', async () => {
    session.history = { tenant_id: 'someone-else', kind: 'rounds_customers' };
    const foreign = await afterImport({ importId: THEIRS });
    expect(foreign).toEqual({ success: false, error: 'That import could not be found.' });

    session.history = null;
    const missing = await afterImport({ importId: OURS });
    expect(missing.success).toBe(false);

    session.history = { tenant_id: 'tenant-1', kind: null };
    const proFile = await afterImport({ importId: OURS });
    expect(proFile.success).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('skips Direct Debit when it is off', async () => {
    session.state = 'off';
    const result = await afterImport({ importId: OURS });
    expect(result).toEqual({ success: true, directDebit: null, directDebitCheckFailed: false });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('returns success with the message flag when the matcher throws', async () => {
    refresh.mockRejectedValue(new Error('GoCardless down'));
    const result = await afterImport({ importId: OURS });
    expect(result).toEqual({ success: true, directDebit: null, directDebitCheckFailed: true });
  });

  it('can be called twice', async () => {
    const first = await afterImport({ importId: OURS });
    const second = await afterImport({ importId: OURS });
    expect(first).toEqual({
      success: true,
      directDebit: { linked: 1, toCheck: 0, notMatched: 0 },
      directDebitCheckFailed: false,
    });
    expect(second.success).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
