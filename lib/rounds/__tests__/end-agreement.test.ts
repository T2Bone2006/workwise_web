import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { endAgreementCore } from '@/lib/rounds/end-agreement';
import { deleteUntouchedFutureVisits } from '@/lib/rounds/visit-transitions';

vi.mock('@/lib/rounds/visit-transitions', () => ({
  deleteUntouchedFutureVisits: vi.fn(async () => 1),
}));

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGREEMENT = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';

function agreementRow(status: 'active' | 'paused' | 'ended' = 'active') {
  return {
    id: AGREEMENT,
    tenant_id: TENANT,
    customer_id: CUSTOMER,
    title: 'Window clean',
    address: '12 Elm Road',
    postcode: 'SW1A 1AA',
    frequency_days: 28,
    duration_minutes: 30,
    price: 12,
    anchor_date: '2026-09-01',
    next_due_date: '2026-09-29',
    schedule_mode: 'fixed',
    status,
    paused_until: status === 'paused' ? '2026-10-01' : null,
  };
}

function client(row: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const supabase = {
    from(table: string) {
      if (table !== 'service_agreements') throw new Error(table);
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({ data: row, error: null }),
                  };
                },
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          return {
            eq() {
              return {
                eq: async () => ({ error: null }),
              };
            },
          };
        },
      };
    },
  };
  return { supabase: supabase as unknown as SupabaseClient, updates };
}

describe('endAgreementCore', () => {
  beforeEach(() => {
    vi.mocked(deleteUntouchedFutureVisits).mockClear();
  });

  it('marks the agreement ended and clears visits that have not started', async () => {
    const { supabase, updates } = client(agreementRow('active'));
    const result = await endAgreementCore(supabase, {
      tenantId: TENANT,
      agreementId: AGREEMENT,
    });
    expect(result).toEqual({ success: true, customerId: CUSTOMER });
    expect(deleteUntouchedFutureVisits).toHaveBeenCalledOnce();
    expect(updates[0]).toMatchObject({
      status: 'ended',
      paused_until: null,
    });
    expect(typeof updates[0]?.ended_at).toBe('string');
  });

  it('does nothing again when the agreement is already ended', async () => {
    const { supabase, updates } = client(agreementRow('ended'));
    const result = await endAgreementCore(supabase, {
      tenantId: TENANT,
      agreementId: AGREEMENT,
    });
    expect(result).toEqual({ success: true, customerId: CUSTOMER });
    expect(deleteUntouchedFutureVisits).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('returns not found when the agreement is missing', async () => {
    const { supabase } = client(null);
    const result = await endAgreementCore(supabase, {
      tenantId: TENANT,
      agreementId: AGREEMENT,
    });
    expect(result).toEqual({ success: false, error: 'Agreement not found' });
  });
});
