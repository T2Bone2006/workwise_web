import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Rec = Record<string, unknown>;

const LEAD_ID = '11111111-1111-4111-8111-111111111111';

const harness = vi.hoisted(() => {
  const state = {
    hasRounds: true,
    liteOk: true,
    tenantId: 'tenant-1' as string | null,
    userId: 'user-1',
    leads: [] as Rec[],
    jobs: [] as Rec[],
    history: [] as Rec[],
    customers: [] as Rec[],
    customerError: false,
    leadUpdateError: false,
    visits: [] as Array<{ tenantId: string; actor: { userId?: string }; values: Rec }>,
    visitMode: 'ok' as 'ok' | 'fail' | 'race',
    revalidated: [] as string[],
  };

  function rowsFor(table: string): Rec[] {
    if (table === 'leads') return state.leads;
    if (table === 'jobs') return state.jobs;
    if (table === 'job_status_history') return state.history;
    return [];
  }

  function builder(table: string) {
    const filters: Array<(row: Rec) => boolean> = [];
    let mode: 'select' | 'update' | 'delete' = 'select';
    let patch: Rec | null = null;

    function matched() {
      return rowsFor(table).filter((row) => filters.every((pred) => pred(row)));
    }

    function execute(single: boolean) {
      if (mode === 'update') {
        if (table === 'leads' && state.leadUpdateError) return { data: null, error: { message: 'boom' } };
        const hit = matched();
        for (const row of hit) Object.assign(row, patch);
        return { data: hit.map((row) => ({ ...row })), error: null };
      }
      if (mode === 'delete') {
        const hit = new Set(matched());
        const list = rowsFor(table);
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (hit.has(list[i])) list.splice(i, 1);
        }
        return { data: null, error: null };
      }
      const hit = matched();
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    }

    const api = {
      select: () => api,
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value);
        return api;
      },
      is: (key: string, value: unknown) => {
        filters.push((row) => (value === null ? row[key] == null : row[key] === value));
        return api;
      },
      update: (next: Rec) => {
        mode = 'update';
        patch = next;
        return api;
      },
      delete: () => {
        mode = 'delete';
        return api;
      },
      maybeSingle: async () => execute(true),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(execute(false)).then(resolve, reject),
    };
    return api;
  }

  const admin = { from: (table: string) => builder(table) } as unknown as SupabaseClient;

  function customerApi() {
    let inserted: Rec | null = null;
    const api = {
      select: () => api,
      insert: (row: Rec) => {
        inserted = row;
        return api;
      },
      eq: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => {
        if (!inserted) return { data: null, error: { message: 'missing' } };
        if (state.customerError) return { data: null, error: { message: 'fail' } };
        const id = `cust-${state.customers.length + 1}`;
        state.customers.push({ id, ...inserted });
        inserted = null;
        return { data: { id }, error: null };
      },
    };
    return api;
  }

  const sessionClient = {
    auth: { getUser: async () => ({ data: { user: { id: state.userId } } }) },
    from(table: string) {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { tenant_id: state.tenantId }, error: null }),
            }),
          }),
        };
      }
      if (table === 'customers') return customerApi();
      return builder(table);
    },
  };

  return { state, admin, sessionClient };
});

vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: async () => ({ data: { id: 'email' }, error: null }) } },
  FROM_EMAIL: 'noreply@joinworkwise.com',
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    harness.state.revalidated.push(path);
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => harness.admin,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => harness.sessionClient,
}));

vi.mock('@/lib/data/tenant', () => ({
  getTenantIdForCurrentUser: async () => harness.state.tenantId,
  getTenantNameForCurrentUser: async () => 'Test',
}));

vi.mock('@/lib/data/tenant-products', () => ({
  getTenantProducts: async () => ({ hasRounds: harness.state.hasRounds, hasLite: true, isPro: false }),
}));

vi.mock('@/lib/lite/require-lite', () => ({
  requireLite: async () =>
    harness.state.liteOk
      ? { ok: true as const, ctx: { tenantId: 'tenant-1', userId: 'user-1', widget: { id: 'widget-1' } } }
      : { ok: false as const, status: 401 as const, error: 'Not signed in' },
}));

vi.mock('@/lib/rounds/one-off', () => ({
  createOneOffVisitCore: async (
    _supabase: unknown,
    p: { tenantId: string; actor: { userId?: string }; values: Rec },
  ) => {
    harness.state.visits.push(p);
    if (harness.state.visitMode === 'fail') return { success: false, error: 'nope' };
    const jobId = 'job-new';
    if (harness.state.visitMode === 'race') {
      const lead = harness.state.leads[0];
      if (lead) lead.converted_job_id = 'job-winner';
    }
    harness.state.jobs.push({ id: jobId, tenant_id: p.tenantId });
    harness.state.history.push({ job_id: jobId });
    return { success: true, jobId };
  },
}));

import { createRoundsCustomer } from '@/lib/actions/customers';
import { bookLeadAsOneOffAction } from '@/lib/actions/lite/lead-to-rounds';
import { buildLeadPrefill, linkLeadToCustomer, linkLeadToJob } from '@/lib/lite/leads-core';

function lead(overrides: Rec = {}): Rec {
  return {
    id: LEAD_ID,
    tenant_id: 'tenant-1',
    status: 'won',
    name: 'Sam Taylor',
    phone: '07700900123',
    email: null,
    postcode: 'M20 6AB',
    job_summary: 'Ceiling skim',
    agreed_amount: 95,
    converted_customer_id: null,
    converted_job_id: null,
    booked_for_date: null,
    booked_for_time: null,
    ...overrides,
  };
}

function customerForm(fromLead = true): FormData {
  const formData = new FormData();
  formData.set('name', 'Sam Taylor');
  formData.set('phone', '07700900123');
  formData.set('email', '');
  formData.set('address', '1 High Street');
  formData.set('postcode', 'M20 6AB');
  formData.set('notes', 'From your website: Ceiling skim. Agreed £95.');
  if (fromLead) formData.set('fromLeadId', LEAD_ID);
  return formData;
}

const booking = {
  leadId: LEAD_ID,
  date: '2026-10-08',
  time: '09:30' as string | null,
  address: '1 High Street',
  postcode: 'M20 6AB',
  price: 95,
  durationMinutes: 60,
  title: 'Ceiling skim',
};

beforeEach(() => {
  harness.state.hasRounds = true;
  harness.state.liteOk = true;
  harness.state.tenantId = 'tenant-1';
  harness.state.leads = [];
  harness.state.jobs = [];
  harness.state.history = [];
  harness.state.customers = [];
  harness.state.customerError = false;
  harness.state.leadUpdateError = false;
  harness.state.visits = [];
  harness.state.visitMode = 'ok';
  harness.state.revalidated = [];
});

describe('prefill notes', () => {
  it('keeps the job summary and the agreed price, and drops empty parts', () => {
    expect(
      buildLeadPrefill({
        id: LEAD_ID,
        name: 'Sam Taylor',
        phone: '07700900123',
        email: 'sam@example.com',
        postcode: 'M20 6AB',
        job_summary: 'Ceiling skim',
        agreed_amount: 95,
      }),
    ).toEqual({
      leadId: LEAD_ID,
      name: 'Sam Taylor',
      phone: '07700900123',
      email: 'sam@example.com',
      postcode: 'M20 6AB',
      notes: 'From your website: Ceiling skim. Agreed £95.',
    });
    expect(buildLeadPrefill({ id: 'a', name: 'Sam', job_summary: 'Ceiling skim', agreed_amount: null }).notes).toBe(
      'From your website: Ceiling skim.',
    );
    expect(buildLeadPrefill({ id: 'a', name: 'Sam', job_summary: '  ', agreed_amount: 40.5 }).notes).toBe(
      'Agreed £40.50.',
    );
    expect(buildLeadPrefill({ id: 'a', name: 'Sam', job_summary: null, agreed_amount: null }).notes).toBe('');
  });
});

describe('linkLeadToCustomer', () => {
  it('links only while converted_customer_id is empty', async () => {
    harness.state.leads = [lead()];
    const linked = await linkLeadToCustomer(harness.admin, {
      tenantId: 'tenant-1',
      leadId: LEAD_ID,
      customerId: 'cust-9',
    });
    expect(linked).toBe('linked');
    expect(harness.state.leads[0].converted_customer_id).toBe('cust-9');

    const same = await linkLeadToCustomer(harness.admin, {
      tenantId: 'tenant-1',
      leadId: LEAD_ID,
      customerId: 'cust-9',
    });
    expect(same).toBe('linked');

    const other = await linkLeadToCustomer(harness.admin, {
      tenantId: 'tenant-1',
      leadId: LEAD_ID,
      customerId: 'cust-other',
    });
    expect(other).toBe('already_linked');
    expect(harness.state.leads[0].converted_customer_id).toBe('cust-9');
  });

  it('returns error when the lead is missing or the update fails', async () => {
    expect(
      await linkLeadToCustomer(harness.admin, { tenantId: 'tenant-1', leadId: LEAD_ID, customerId: 'cust-9' }),
    ).toBe('error');

    harness.state.leads = [lead()];
    harness.state.leadUpdateError = true;
    expect(
      await linkLeadToCustomer(harness.admin, { tenantId: 'tenant-1', leadId: LEAD_ID, customerId: 'cust-9' }),
    ).toBe('error');
    expect(harness.state.leads[0].converted_customer_id).toBeNull();
  });
});

describe('linkLeadToJob', () => {
  it('stores the job and the booked slot, and does not overwrite a winner', async () => {
    harness.state.leads = [lead()];
    const linked = await linkLeadToJob(harness.admin, {
      tenantId: 'tenant-1',
      leadId: LEAD_ID,
      jobId: 'job-1',
      date: '2026-10-08',
      time: '09:30',
    });
    expect(linked).toBe('linked');
    expect(harness.state.leads[0]).toMatchObject({
      converted_job_id: 'job-1',
      booked_for_date: '2026-10-08',
      booked_for_time: '09:30',
    });

    const again = await linkLeadToJob(harness.admin, {
      tenantId: 'tenant-1',
      leadId: LEAD_ID,
      jobId: 'job-1',
      date: '2026-10-09',
      time: null,
    });
    expect(again).toBe('linked');
    expect(harness.state.leads[0].booked_for_date).toBe('2026-10-08');

    const race = await linkLeadToJob(harness.admin, {
      tenantId: 'tenant-1',
      leadId: LEAD_ID,
      jobId: 'job-2',
      date: '2026-10-10',
      time: '11:00',
    });
    expect(race).toBe('already_linked');
    expect(harness.state.leads[0].converted_job_id).toBe('job-1');
  });
});

describe('createRoundsCustomer from a lead', () => {
  it('links the new customer, and a lost race still keeps the customer', async () => {
    harness.state.leads = [lead()];
    const created = await createRoundsCustomer(customerForm());
    expect(created).toEqual({ success: true, id: 'cust-1' });
    expect(harness.state.leads[0].converted_customer_id).toBe('cust-1');

    harness.state.leads = [lead({ converted_customer_id: 'cust-other' })];
    const raced = await createRoundsCustomer(customerForm());
    expect(raced).toEqual({
      success: true,
      id: 'cust-2',
      warning: "Customer added, but it couldn't be linked to the enquiry.",
    });
    expect(harness.state.leads[0].converted_customer_id).toBe('cust-other');
  });

  it('leaves linking alone when there is no fromLeadId', async () => {
    harness.state.leads = [lead()];
    const created = await createRoundsCustomer(customerForm(false));
    expect(created).toEqual({ success: true, id: 'cust-1' });
    expect(created).not.toHaveProperty('warning');
    expect(harness.state.leads[0].converted_customer_id).toBeNull();
  });
});

describe('bookLeadAsOneOffAction', () => {
  it('refuses when the business has no Rounds', async () => {
    harness.state.hasRounds = false;
    harness.state.leads = [lead()];
    const result = await bookLeadAsOneOffAction(booking);
    expect(result).toEqual({ success: false, error: 'One-off visits are part of Rounds.' });
    expect(harness.state.customers).toHaveLength(0);
    expect(harness.state.visits).toHaveLength(0);
  });

  it('refuses a lead that is not won', async () => {
    harness.state.leads = [lead({ status: 'contacted' })];
    const result = await bookLeadAsOneOffAction(booking);
    expect(result).toEqual({ success: false, error: 'Mark the lead as won first.' });
    expect(harness.state.customers).toHaveLength(0);
    expect(harness.state.visits).toHaveLength(0);
  });

  it('returns the existing job and creates nothing new', async () => {
    harness.state.leads = [lead({ converted_job_id: 'job-existing', converted_customer_id: 'cust-existing' })];
    const result = await bookLeadAsOneOffAction(booking);
    expect(result).toEqual({ success: true, jobId: 'job-existing', customerId: 'cust-existing' });
    expect(harness.state.customers).toHaveLength(0);
    expect(harness.state.visits).toHaveLength(0);
  });

  it('books one visit and remembers it on the lead', async () => {
    harness.state.leads = [lead()];
    const result = await bookLeadAsOneOffAction(booking);
    expect(result).toEqual({ success: true, jobId: 'job-new', customerId: 'cust-1' });
    expect(harness.state.leads[0]).toMatchObject({
      converted_customer_id: 'cust-1',
      converted_job_id: 'job-new',
      booked_for_date: '2026-10-08',
      booked_for_time: '09:30',
    });
    expect(harness.state.visits[0]).toMatchObject({
      tenantId: 'tenant-1',
      actor: { userId: 'user-1' },
      values: {
        customer_id: 'cust-1',
        title: 'Ceiling skim',
        address: '1 High Street',
        postcode: 'M20 6AB',
        price: 95,
        duration_minutes: 60,
        scheduled_date: '2026-10-08',
        scheduled_time: '09:30',
      },
    });
    expect(harness.state.revalidated).toEqual(
      expect.arrayContaining([`/lite/leads/${LEAD_ID}`, '/lite', '/calendar']),
    );
  });

  it('deletes the loser job when a second click already linked one', async () => {
    harness.state.leads = [lead()];
    harness.state.visitMode = 'race';
    const result = await bookLeadAsOneOffAction(booking);
    expect(result).toEqual({ success: true, jobId: 'job-winner', customerId: 'cust-1' });
    expect(harness.state.jobs).toEqual([]);
    expect(harness.state.history).toEqual([]);
    expect(harness.state.leads[0].converted_job_id).toBe('job-winner');
    expect(harness.state.leads[0].converted_customer_id).toBe('cust-1');
  });

  it('keeps the linked customer when the visit fails', async () => {
    harness.state.leads = [lead()];
    harness.state.visitMode = 'fail';
    const result = await bookLeadAsOneOffAction(booking);
    expect(result).toEqual({
      success: false,
      error: "Customer added, but the visit wasn't booked — try again.",
    });
    expect(harness.state.customers).toHaveLength(1);
    expect(harness.state.leads[0].converted_customer_id).toBe('cust-1');
    expect(harness.state.leads[0].converted_job_id).toBeNull();
    expect(harness.state.jobs).toEqual([]);
  });

  it('books only the visit when the customer is already linked', async () => {
    harness.state.leads = [lead({ converted_customer_id: 'cust-existing' })];
    const result = await bookLeadAsOneOffAction({ ...booking, time: null });
    expect(result).toEqual({ success: true, jobId: 'job-new', customerId: 'cust-existing' });
    expect(harness.state.customers).toHaveLength(0);
    expect(harness.state.leads[0]).toMatchObject({
      converted_customer_id: 'cust-existing',
      converted_job_id: 'job-new',
      booked_for_time: null,
    });
  });

  it('keeps the visit when the lead link fails', async () => {
    harness.state.leads = [lead({ converted_customer_id: 'cust-existing' })];
    harness.state.leadUpdateError = true;
    const result = await bookLeadAsOneOffAction(booking);
    expect(result).toEqual({
      success: true,
      jobId: 'job-new',
      customerId: 'cust-existing',
      warning: "Visit booked, but it couldn't be linked to the enquiry.",
    });
    expect(harness.state.jobs).toEqual([{ id: 'job-new', tenant_id: 'tenant-1' }]);
    expect(harness.state.leads[0].converted_job_id).toBeNull();
  });
});
