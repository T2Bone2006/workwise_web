import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, todayInLondon } from '@/lib/rounds/dates';

const getTenantMessagingContext = vi.fn();
const sendCustomerMessage = vi.fn();

vi.mock('@/lib/messaging/brand', () => ({
  getTenantMessagingContext: (...args: unknown[]) =>
    getTenantMessagingContext(...args),
}));

vi.mock('@/lib/messaging/send', () => ({
  sendCustomerMessage: (...args: unknown[]) => sendCustomerMessage(...args),
}));

import { runRemindersForTenant } from '@/lib/messaging/run-reminders';

type JobRow = {
  id: string;
  customer_id: string;
  service_agreement_id: string;
  status: string;
  scheduled_date: string;
  scheduled_time: string | null;
  address: string;
  postcode: string;
  route_position: number | null;
  custom_fields: unknown;
  job_description: string | null;
  service_agreements: { reminder_enabled: boolean } | null;
};

type CustomerRow = {
  id: string;
  is_active: boolean;
  visit_reminders: boolean;
  preferred_channel: string | null;
  phone_e164: string | null;
};

type FakeDb = {
  jobs: JobRow[];
  customers: CustomerRow[];
  toldJobIds: string[][];
};

let db: FakeDb;

function filtersMatch(
  row: Record<string, unknown>,
  filters: { col: string; op: string; val: unknown }[],
): boolean {
  for (const f of filters) {
    // Tenant scoping is assumed in the fake; rows omit tenant_id.
    if (f.col === 'tenant_id') continue;
    if (f.col === 'kind' || f.col === 'direction') continue;
    if (!(f.col in row) && f.op !== 'in') continue;
    const value = row[f.col];
    if (f.op === 'eq' && value !== f.val) return false;
    if (f.op === 'in') {
      const list = f.val as unknown[];
      if (f.col === 'id' && !list.includes(value)) return false;
      if (f.col === 'status') continue; // messages status filter only
    }
    if (f.op === 'not_null' && value == null) return false;
    if (f.op === 'gte' && typeof value === 'string' && typeof f.val === 'string') {
      if (value < f.val) return false;
    }
  }
  return true;
}

function buildAdmin(): SupabaseClient {
  return {
    from(table: string) {
      const state: {
        filters: { col: string; op: string; val: unknown }[];
      } = { filters: [] };

      const api = {
        select() {
          return api;
        },
        eq(col: string, val: unknown) {
          state.filters.push({ col, op: 'eq', val });
          return api;
        },
        in(col: string, val: unknown[]) {
          state.filters.push({ col, op: 'in', val });
          return api;
        },
        not(col: string, op: string, val: unknown) {
          if (op === 'is' && val === null) {
            state.filters.push({ col, op: 'not_null', val: null });
          }
          return api;
        },
        gte(col: string, val: unknown) {
          state.filters.push({ col, op: 'gte', val });
          return api;
        },
        then(
          resolve: (value: { data: unknown; error: null }) => void,
        ) {
          if (table === 'jobs') {
            const data = db.jobs.filter((row) =>
              filtersMatch(row as unknown as Record<string, unknown>, state.filters),
            );
            resolve({ data, error: null });
            return;
          }
          if (table === 'customers') {
            const data = db.customers.filter((row) =>
              filtersMatch(row as unknown as Record<string, unknown>, state.filters),
            );
            resolve({ data, error: null });
            return;
          }
          if (table === 'messages') {
            resolve({
              data: db.toldJobIds.map((job_ids) => ({ job_ids })),
              error: null,
            });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
      return api;
    },
  } as unknown as SupabaseClient;
}

const TENANT = 'tenant-1';
const NOW = new Date('2026-09-28T17:00:00.000Z');

function defaultCtx(daysBefore = 3) {
  return {
    tenantId: TENANT,
    businessName: 'Acme Windows',
    contactPhone: '+447700900999',
    replyToEmail: null,
    logoUrl: null,
    settings: {
      reminders_enabled: true,
      reminder_days_before: daysBefore,
      chasers_enabled: true,
      chase_first_days: 7,
      chase_second_days: 21,
      money_channel: 'email_first' as const,
      change_channel: 'text_first' as const,
      contact_phone: '+447700900999',
    },
  };
}

function job(overrides: Partial<JobRow> & Pick<JobRow, 'id'>): JobRow {
  const target = addDays(todayInLondon(NOW), 3);
  return {
    customer_id: 'cust-1',
    service_agreement_id: 'agr-1',
    status: 'assigned',
    scheduled_date: target,
    scheduled_time: '09:00',
    address: '12 High Street',
    postcode: 'SW1A 1AA',
    route_position: 1,
    custom_fields: { rounds: { service_name: 'Window clean' } },
    job_description: 'Window clean',
    service_agreements: { reminder_enabled: true },
    ...overrides,
  };
}

beforeEach(() => {
  db = {
    jobs: [job({ id: 'job-1' })],
    customers: [
      {
        id: 'cust-1',
        is_active: true,
        visit_reminders: true,
        preferred_channel: null,
        phone_e164: '+447700900123',
      },
    ],
    toldJobIds: [],
  };
  getTenantMessagingContext.mockReset();
  getTenantMessagingContext.mockResolvedValue(defaultCtx(3));
  sendCustomerMessage.mockReset();
  sendCustomerMessage.mockResolvedValue({
    outcome: 'text_sent',
    messageId: 'msg-1',
  });
});

describe('runRemindersForTenant', () => {
  it('target date uses reminder_days_before', async () => {
    getTenantMessagingContext.mockResolvedValue(defaultCtx(5));
    const target = addDays(todayInLondon(NOW), 5);
    db.jobs = [job({ id: 'job-5', scheduled_date: target })];

    const result = await runRemindersForTenant(buildAdmin(), TENANT, NOW);

    expect(result.targetDate).toBe(target);
    expect(result.planned).toBe(1);
    expect(sendCustomerMessage).toHaveBeenCalledTimes(1);
  });

  it('passes bindThread: true and email: null', async () => {
    await runRemindersForTenant(buildAdmin(), TENANT, NOW);

    expect(sendCustomerMessage).toHaveBeenCalledTimes(1);
    const input = sendCustomerMessage.mock.calls[0]![0] as {
      bindThread?: boolean;
      email: unknown;
      kind: string;
    };
    expect(input.bindThread).toBe(true);
    expect(input.email).toBeNull();
    expect(input.kind).toBe('reminder');
  });

  it('excludes told job ids', async () => {
    db.toldJobIds = [['job-1']];

    const result = await runRemindersForTenant(buildAdmin(), TENANT, NOW);

    expect(result.planned).toBe(0);
    expect(sendCustomerMessage).not.toHaveBeenCalled();
  });
});
