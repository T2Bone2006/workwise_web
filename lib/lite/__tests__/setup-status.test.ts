import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { getSetupStatus } from '@/lib/lite/setup-status';

type Rec = Record<string, unknown>;

function admin(tables: Record<string, Rec[]>): SupabaseClient {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const filters: Array<(row: Rec) => boolean> = [];
      const api = {
        select: () => api,
        eq: (key: string, value: unknown) => {
          filters.push((row) => row[key] === value);
          return api;
        },
        maybeSingle: async () => ({
          data: rows.find((row) => filters.every((pred) => pred(row))) ?? null,
          error: null,
        }),
      };
      return api;
    },
  } as unknown as SupabaseClient;
}

const tenant = 'tenant-1';

describe('getSetupStatus', () => {
  it('is not started when there is no interview and no profile', async () => {
    const status = await getSetupStatus(admin({}), tenant);
    expect(status).toEqual({ state: 'not_started' });
  });

  it('is in progress with the open interview stage', async () => {
    const status = await getSetupStatus(
      admin({
        lite_interviews: [{ id: 'int-1', tenant_id: tenant, status: 'in_progress', stage: 'pricing' }],
      }),
      tenant,
    );
    expect(status).toEqual({ state: 'in_progress', interviewId: 'int-1', stage: 'pricing' });
  });

  it('is live once a price profile exists', async () => {
    const status = await getSetupStatus(
      admin({
        lite_price_profiles: [{ tenant_id: tenant, version: 2 }],
        widget_clients: [{ tenant_id: tenant, website_url: 'daveplastering.co.uk' }],
      }),
      tenant,
    );
    expect(status).toEqual({
      state: 'live',
      profileVersion: 2,
      website: 'daveplastering.co.uk',
      redoInProgress: false,
    });
  });

  it('stays live when a redo is also in progress', async () => {
    const status = await getSetupStatus(
      admin({
        lite_price_profiles: [{ tenant_id: tenant, version: 2 }],
        lite_interviews: [{ id: 'int-2', tenant_id: tenant, status: 'in_progress', stage: 'areas' }],
        widget_clients: [{ tenant_id: tenant, website_url: '' }],
      }),
      tenant,
    );
    expect(status).toEqual({
      state: 'live',
      profileVersion: 2,
      website: null,
      redoInProgress: true,
    });
  });
});
