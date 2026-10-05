import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { setAutoAccept } from '@/lib/lite/interview';
import type { PriceProfile } from '@/lib/lite/profile-schema';
import type { LiteContext } from '@/lib/lite/require-lite';

const ctx: LiteContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  widget: {
    id: 'widget-1',
    business_name: "Dave's Plastering",
    sign_off_name: null,
    trade: 'plastering',
    service_area: 'South Manchester',
    business_context: '',
  },
};

function profile(overrides?: Partial<PriceProfile>): PriceProfile {
  return {
    areas: { summary: 'South Manchester', postcodes: ['M20'], max_miles: 15 },
    callout_fee: 40,
    hourly_rate: null,
    day_rate: null,
    minimum_charge: null,
    materials: 'Customer buys the plaster',
    job_types: [
      {
        key: 'patch',
        name: 'Patch repair',
        how_priced: 'from_description',
        guide_min: 70,
        guide_max: 120,
        what_changes_price: 'Size of the hole',
        auto_accept: false,
      },
      {
        key: 'ceiling',
        name: 'Ceiling',
        how_priced: 'needs_visit',
        guide_min: null,
        guide_max: null,
        what_changes_price: '',
        auto_accept: false,
      },
    ],
    rules: ['No Sundays'],
    example_jobs: [{ description: 'A small patch', price: 80, reasoning: 'An hour of work' }],
    tone: 'Warm',
    ...overrides,
  };
}

type Row = { tenant_id: string; profile: unknown; updated_at: string };

function harness(initial: Row | null, opts?: { conflicts?: number }) {
  let row = initial ? { ...initial, profile: structuredClone(initial.profile) } : null;
  let conflictsLeft = opts?.conflicts ?? 0;
  const admin = {
    from(table: string) {
      if (table !== 'lite_price_profiles') throw new Error(table);
      const filters: Record<string, unknown> = {};
      let patch: { profile?: unknown } | null = null;
      const api = {
        select: () => api,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return api;
        },
        update: (next: { profile?: unknown }) => {
          patch = next;
          return api;
        },
        maybeSingle: async () => {
          if (!row || filters.tenant_id !== row.tenant_id) return { data: null, error: null };
          return { data: { profile: structuredClone(row.profile), updated_at: row.updated_at }, error: null };
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          const run = () => {
            if (!patch || !row || filters.tenant_id !== row.tenant_id || filters.updated_at !== row.updated_at) {
              return { data: [], error: null };
            }
            if (conflictsLeft > 0) {
              conflictsLeft -= 1;
              const current = row.profile as PriceProfile;
              row = {
                ...row,
                updated_at: `t-conflict-${conflictsLeft}`,
                profile: { ...current, materials: 'Changed in the other tab' },
              };
              return { data: [], error: null };
            }
            row = { ...row, profile: patch.profile, updated_at: 't-written' };
            return { data: [{ tenant_id: row.tenant_id }], error: null };
          };
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return api;
    },
  };
  return {
    admin: admin as unknown as SupabaseClient,
    saved: () => row?.profile as PriceProfile | undefined,
  };
}

describe('setAutoAccept', () => {
  it('turns auto-accept on and off for work priced from a description', async () => {
    const box = harness({ tenant_id: 'tenant-1', profile: profile(), updated_at: 't1' });
    const on = await setAutoAccept(box.admin, ctx, { key: 'patch', on: true });
    expect(on).toEqual({ ok: true });
    expect(box.saved()?.job_types[0].auto_accept).toBe(true);
    expect(box.saved()?.job_types[1].auto_accept).toBe(false);

    const off = await setAutoAccept(box.admin, ctx, { key: 'patch', on: false });
    expect(off).toEqual({ ok: true });
    expect(box.saved()?.job_types[0].auto_accept).toBe(false);
  });

  it('refuses to turn on a needs-a-visit job and an unknown key', async () => {
    const box = harness({ tenant_id: 'tenant-1', profile: profile(), updated_at: 't1' });
    const visit = await setAutoAccept(box.admin, ctx, { key: 'ceiling', on: true });
    expect(visit).toEqual({ ok: false, error: 'needs_visit' });
    expect(box.saved()?.job_types[1].auto_accept).toBe(false);

    const missing = await setAutoAccept(box.admin, ctx, { key: 'nope', on: true });
    expect(missing).toEqual({ ok: false, error: 'no_such_work' });
  });

  it('reports no profile when nothing is saved', async () => {
    const box = harness(null);
    const result = await setAutoAccept(box.admin, ctx, { key: 'patch', on: true });
    expect(result).toEqual({ ok: false, error: 'no_profile' });
  });

  it('retries once after a conflict and keeps the other tab’s change', async () => {
    const raced = harness({ tenant_id: 'tenant-1', profile: profile(), updated_at: 't1' }, { conflicts: 1 });
    const retried = await setAutoAccept(raced.admin, ctx, { key: 'patch', on: true });
    expect(retried).toEqual({ ok: true });
    expect(raced.saved()?.materials).toBe('Changed in the other tab');
    expect(raced.saved()?.job_types[0].auto_accept).toBe(true);
  });

  it('stops after a second conflict', async () => {
    const box = harness({ tenant_id: 'tenant-1', profile: profile(), updated_at: 't1' }, { conflicts: 2 });
    const result = await setAutoAccept(box.admin, ctx, { key: 'patch', on: true });
    expect(result).toEqual({ ok: false, error: 'save_failed' });
    expect(box.saved()?.job_types[0].auto_accept).toBe(false);
  });
});
