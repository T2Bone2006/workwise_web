import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatVisitDay } from '@/lib/payments/messages';
import {
  moveRemainingSchema,
  rescheduleVisitSchema,
  skipRemainingSchema,
  skipVisitSchema,
} from '@/lib/validations/rounds/visit';

const getTenantMessagingContext = vi.fn();
const sendCustomerMessage = vi.fn();

vi.mock('@/lib/messaging/brand', () => ({
  getTenantMessagingContext: (...args: unknown[]) =>
    getTenantMessagingContext(...args),
}));

vi.mock('@/lib/messaging/send', () => ({
  sendCustomerMessage: (...args: unknown[]) => sendCustomerMessage(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => fakeAdmin,
}));

import {
  notifyVisitChange,
  notifyVisitChangeUndone,
} from '@/lib/messaging/visit-change-notices';

type Row = Record<string, unknown>;

type Filter =
  | { op: 'eq'; col: string; val: unknown }
  | { op: 'in'; col: string; val: unknown[] }
  | { op: 'gt'; col: string; val: unknown }
  | { op: 'is'; col: string; val: unknown };

type FakeDb = {
  changes: Row[];
  jobs: Row[];
  messages: Row[];
  customers: Row[];
  refunds: Record<string, unknown>[];
};

const TENANT = 'tenant-1';
const CHANGE = 'change-1';
const NOW = new Date('2026-10-01T10:00:00.000Z');
const ZEROS = {
  stops: 0,
  texted: 0,
  held: 0,
  emailed: 0,
  skipped: 0,
  failed: 0,
};

let db: FakeDb;
let fakeAdmin: SupabaseClient;

function matches(row: Row, filters: Filter[]): boolean {
  for (const filter of filters) {
    const value = row[filter.col];
    if (filter.op === 'eq' && value !== filter.val) return false;
    if (filter.op === 'in' && !filter.val.includes(value)) return false;
    if (filter.op === 'is' && value !== filter.val) return false;
    if (filter.op === 'gt') {
      if (typeof value !== 'string' && typeof value !== 'number') return false;
      if (String(value) <= String(filter.val)) return false;
    }
  }
  return true;
}

function tableRows(table: string): Row[] {
  if (table === 'visit_changes') return db.changes;
  if (table === 'jobs') return db.jobs;
  if (table === 'messages') return db.messages;
  if (table === 'customers') return db.customers;
  return [];
}

function buildAdmin(): SupabaseClient {
  return {
    from(table: string) {
      const filters: Filter[] = [];
      let op: 'select' | 'update' = 'select';
      let payload: Row | null = null;
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitN: number | null = null;

      const run = (mode: 'many' | 'one') => {
        const matched = tableRows(table).filter((row) => matches(row, filters));
        if (op === 'update' && payload) {
          for (const row of matched) Object.assign(row, payload);
        }
        let rows = matched;
        if (op === 'select') {
          if (orderCol) {
            const col = orderCol;
            rows = [...rows].sort((a, b) => {
              const av = String(a[col] ?? '');
              const bv = String(b[col] ?? '');
              const cmp = av < bv ? -1 : av > bv ? 1 : 0;
              return orderAsc ? cmp : -cmp;
            });
          }
          if (limitN != null) rows = rows.slice(0, limitN);
        }
        return {
          data: mode === 'one' ? (rows[0] ?? null) : rows,
          error: null,
        };
      };

      const builder = {
        select() {
          return builder;
        },
        update(row: Row) {
          op = 'update';
          payload = row;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push({ op: 'eq', col, val });
          return builder;
        },
        in(col: string, val: unknown[]) {
          filters.push({ op: 'in', col, val });
          return builder;
        },
        gt(col: string, val: unknown) {
          filters.push({ op: 'gt', col, val });
          return builder;
        },
        is(col: string, val: unknown) {
          filters.push({ op: 'is', col, val });
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orderCol = col;
          orderAsc = opts?.ascending !== false;
          return builder;
        },
        limit(n: number) {
          limitN = n;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(run('one'));
        },
        then(
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(run('many')).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'refund_text_credits') {
        db.refunds.push(args);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
  } as unknown as SupabaseClient;
}

function job(overrides: Row & { id: string }): Row {
  return {
    tenant_id: TENANT,
    customer_id: 'cust-1',
    address: '1 High Street',
    postcode: 'SW1A 1AA',
    service_agreement_id: 'agr-1',
    route_position: 1,
    scheduled_time: '09:00',
    status: 'assigned',
    scheduled_date: '2026-10-01',
    ...overrides,
  };
}

function changeRow(overrides: Row = {}): Row {
  return {
    id: CHANGE,
    tenant_id: TENANT,
    kind: 'move_remaining',
    from_date: '2026-10-01',
    to_date: '2026-10-06',
    job_ids: ['job-1'],
    before: [{ job_id: 'job-1', scheduled_date: '2026-10-01' }],
    notify_customers: true,
    notified_at: null,
    undo_notified_at: null,
    ...overrides,
  };
}

function texts(): string[] {
  return sendCustomerMessage.mock.calls.map((call) => {
    const input = call[0] as { text: (ctx: { firstText: boolean }) => string };
    return input.text({ firstText: true });
  });
}

beforeEach(() => {
  db = {
    changes: [changeRow()],
    jobs: [job({ id: 'job-1' })],
    messages: [],
    customers: [],
    refunds: [],
  };
  fakeAdmin = buildAdmin();
  getTenantMessagingContext.mockReset();
  getTenantMessagingContext.mockResolvedValue({
    tenantId: TENANT,
    businessName: 'Acme Windows',
    contactPhone: null,
    replyToEmail: null,
    logoUrl: null,
    settings: {},
  });
  sendCustomerMessage.mockReset();
  sendCustomerMessage.mockResolvedValue({ outcome: 'text_sent', messageId: 'msg-1' });
});

describe('visit change notices', () => {
  it('claims the change once, so a second notify does nothing', async () => {
    const first = await notifyVisitChange({
      tenantId: TENANT,
      changeId: CHANGE,
      now: NOW,
    });

    expect(first).toEqual({ ...ZEROS, stops: 1, texted: 1 });
    expect(sendCustomerMessage).toHaveBeenCalledTimes(1);
    const sent = sendCustomerMessage.mock.calls[0]![0] as {
      kind: string;
      dedupeKey: string;
      bindThread: boolean;
      visitChangeId: string;
      jobIds: string[];
    };
    expect(sent.kind).toBe('visit_change');
    expect(sent.dedupeKey).toBe(`change:${CHANGE}:job-1`);
    expect(sent.bindThread).toBe(true);
    expect(sent.visitChangeId).toBe(CHANGE);
    expect(sent.jobIds).toEqual(['job-1']);
    expect(db.changes[0]?.notified_at).toBe(NOW.toISOString());

    const second = await notifyVisitChange({
      tenantId: TENANT,
      changeId: CHANGE,
      now: NOW,
    });
    expect(second).toEqual(ZEROS);
    expect(sendCustomerMessage).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the change did not ask to tell customers', async () => {
    db.changes = [changeRow({ notify_customers: false })];

    const counts = await notifyVisitChange({ tenantId: TENANT, changeId: CHANGE, now: NOW });

    expect(counts).toEqual(ZEROS);
    expect(sendCustomerMessage).not.toHaveBeenCalled();
    expect(db.changes[0]?.notified_at).toBeNull();
  });

  it('sends one message per house, including two services at the same house', async () => {
    db.jobs = [
      job({ id: 'job-a1', customer_id: 'cust-a', service_agreement_id: 'agr-a1' }),
      job({
        id: 'job-a2',
        customer_id: 'cust-a',
        service_agreement_id: 'agr-a2',
        route_position: 2,
      }),
      job({
        id: 'job-b',
        customer_id: 'cust-b',
        address: '2 Bridge Road',
        postcode: 'SW1A 2BB',
        service_agreement_id: 'agr-b',
        route_position: 3,
      }),
      job({
        id: 'job-c',
        customer_id: 'cust-c',
        address: '3 Mill Lane',
        postcode: 'SW1A 3CC',
        service_agreement_id: 'agr-c',
        route_position: 4,
      }),
    ];
    db.changes = [
      changeRow({
        job_ids: ['job-a1', 'job-a2', 'job-b', 'job-c'],
        before: ['job-a1', 'job-a2', 'job-b', 'job-c'].map((id) => ({
          job_id: id,
          scheduled_date: '2026-10-01',
        })),
      }),
    ];

    const counts = await notifyVisitChange({ tenantId: TENANT, changeId: CHANGE, now: NOW });

    expect(counts).toEqual({ ...ZEROS, stops: 3, texted: 3 });
    expect(sendCustomerMessage).toHaveBeenCalledTimes(3);
    const calls = sendCustomerMessage.mock.calls.map(
      (call) => call[0] as { customerId: string; jobIds: string[] },
    );
    expect(calls.find((call) => call.customerId === 'cust-a')?.jobIds).toEqual([
      'job-a1',
      'job-a2',
    ]);
    const fromDay = formatVisitDay('2026-10-01');
    const toDay = formatVisitDay('2026-10-06');
    for (const text of texts()) {
      expect(text).toContain(`can't make it on ${fromDay}`);
      expect(text).toContain(`We'll come on ${toDay} instead`);
    }
  });

  it('names the next visit on a skip, or says see you next time when there is none', async () => {
    db.jobs = [
      job({
        id: 'job-1',
        status: 'cancelled',
        service_agreement_id: 'agr-1',
      }),
      job({
        id: 'job-next',
        customer_id: 'cust-1',
        service_agreement_id: 'agr-1',
        status: 'assigned',
        scheduled_date: '2026-10-30',
      }),
      job({
        id: 'job-2',
        customer_id: 'cust-2',
        address: '9 Oak Road',
        postcode: 'SW1A 9OO',
        service_agreement_id: null,
        status: 'cancelled',
        route_position: 2,
      }),
    ];
    db.changes = [
      changeRow({
        kind: 'skip_remaining',
        to_date: null,
        job_ids: ['job-1', 'job-2'],
        before: [
          { job_id: 'job-1', scheduled_date: '2026-10-01' },
          { job_id: 'job-2', scheduled_date: '2026-10-01' },
        ],
      }),
    ];

    const counts = await notifyVisitChange({ tenantId: TENANT, changeId: CHANGE, now: NOW });

    expect(counts).toEqual({ ...ZEROS, stops: 2, texted: 2 });
    const sent = texts();
    expect(sent[0]).toContain(`See you next time on ${formatVisitDay('2026-10-30')}`);
    expect(sent[1]).toContain('See you next time.');
    expect(sent[1]).not.toContain('See you next time on');
  });

  it('sends after all only to stops already told, and refunds texts still held', async () => {
    db.jobs = [
      job({ id: 'job-1', customer_id: 'cust-1', status: 'cancelled' }),
      job({
        id: 'job-2',
        customer_id: 'cust-2',
        address: '2 Bridge Road',
        postcode: 'SW1A 2BB',
        status: 'cancelled',
      }),
      job({
        id: 'job-left',
        customer_id: 'cust-left',
        address: '8 Left Road',
        postcode: 'SW1A 8LL',
        status: 'cancelled',
      }),
    ];
    db.changes = [
      changeRow({
        kind: 'skip_remaining',
        to_date: null,
        job_ids: ['job-1', 'job-2', 'job-left'],
        before: [
          { job_id: 'job-1', scheduled_date: '2026-10-01' },
          { job_id: 'job-2', scheduled_date: '2026-10-01' },
          { job_id: 'job-left', scheduled_date: '2026-10-01' },
        ],
      }),
    ];
    db.messages = [
      {
        id: 'msg-1',
        tenant_id: TENANT,
        visit_change_id: CHANGE,
        kind: 'visit_change',
        status: 'sent',
        channel: 'sms',
        customer_id: 'cust-1',
        job_ids: ['job-1'],
      },
      {
        id: 'msg-2',
        tenant_id: TENANT,
        visit_change_id: CHANGE,
        kind: 'visit_change',
        status: 'delivered',
        channel: 'sms',
        customer_id: 'cust-2',
        job_ids: ['job-2'],
      },
      {
        id: 'msg-left',
        tenant_id: TENANT,
        visit_change_id: CHANGE,
        kind: 'visit_change',
        status: 'sent',
        channel: 'sms',
        customer_id: 'cust-left',
        job_ids: ['job-left'],
      },
    ];

    const told = await notifyVisitChangeUndone({
      tenantId: TENANT,
      changeId: CHANGE,
      restoredJobIds: ['job-1', 'job-2'],
      now: NOW,
    });

    expect(told).toEqual({ ...ZEROS, stops: 2, texted: 2 });
    expect(sendCustomerMessage).toHaveBeenCalledTimes(2);
    const customers = sendCustomerMessage.mock.calls.map(
      (call) => (call[0] as { customerId: string; dedupeKey: string }).customerId,
    );
    expect(customers).toEqual(['cust-1', 'cust-2']);
    for (const text of texts()) {
      expect(text).toContain('good news');
      expect(text).toContain(`on ${formatVisitDay('2026-10-01')}`);
      expect(text).toContain('after all');
    }
    expect(db.refunds).toEqual([]);
    expect(db.changes[0]?.undo_notified_at).toBe(NOW.toISOString());

    sendCustomerMessage.mockClear();
    db.refunds = [];
    db.changes[0]!.undo_notified_at = null;
    db.messages = [
      {
        id: 'msg-held',
        tenant_id: TENANT,
        visit_change_id: CHANGE,
        kind: 'visit_change',
        status: 'held',
        channel: 'sms',
        customer_id: 'cust-1',
        job_ids: ['job-1'],
        segments: 1,
        billed_from: 'allowance',
        billed_month: '2026-10',
      },
      {
        id: 'msg-held-left',
        tenant_id: TENANT,
        visit_change_id: CHANGE,
        kind: 'visit_change',
        status: 'held',
        channel: 'sms',
        customer_id: 'cust-left',
        job_ids: ['job-left'],
        segments: 1,
        billed_from: 'allowance',
        billed_month: '2026-10',
      },
    ];

    const held = await notifyVisitChangeUndone({
      tenantId: TENANT,
      changeId: CHANGE,
      restoredJobIds: ['job-1'],
      now: NOW,
    });

    expect(held.texted).toBe(0);
    expect(held.stops).toBe(0);
    expect(sendCustomerMessage).not.toHaveBeenCalled();
    expect(db.messages.find((row) => row.id === 'msg-held')).toMatchObject({
      status: 'skipped',
      error: 'undone before sending',
    });
    expect(db.messages.find((row) => row.id === 'msg-held-left')?.status).toBe('held');
    expect(db.refunds).toEqual([
      {
        p_tenant_id: TENANT,
        p_segments: 1,
        p_from: 'allowance',
        p_month: '2026-10',
      },
    ]);
  });

  it('counts a reply ack as told, so Undo of a reply move says after all', async () => {
    db.jobs = [job({ id: 'job-1', customer_id: 'cust-1', status: 'assigned' })];
    db.changes = [
      changeRow({
        kind: 'reschedule',
        to_date: '2026-10-05',
        job_ids: ['job-1'],
        before: [{ job_id: 'job-1', scheduled_date: '2026-10-02' }],
      }),
    ];
    db.messages = [
      {
        id: 'msg-ack',
        tenant_id: TENANT,
        visit_change_id: CHANGE,
        kind: 'reply_ack',
        status: 'delivered',
        channel: 'sms',
        customer_id: 'cust-1',
        job_ids: ['job-1'],
      },
    ];

    const counts = await notifyVisitChangeUndone({
      tenantId: TENANT,
      changeId: CHANGE,
      restoredJobIds: ['job-1'],
      now: NOW,
    });

    expect(counts).toEqual({ ...ZEROS, stops: 1, texted: 1 });
    const [text] = texts();
    expect(text).toContain('after all');
    expect(text).toContain(`on ${formatVisitDay('2026-10-02')}`);
  });

  it('treats an old phone body without notifyCustomers as no notice', () => {
    const jobId = '11111111-1111-4111-8111-111111111111';
    expect(
      skipVisitSchema.parse({ jobId, reason: 'no_access' }).notifyCustomer ?? false,
    ).toBe(false);
    expect(
      rescheduleVisitSchema.parse({
        jobId,
        scheduledDate: '2026-10-06',
        scheduledTime: '',
      }).notifyCustomer ?? false,
    ).toBe(false);
    expect(
      moveRemainingSchema.parse({
        fromDate: '2026-10-01',
        toDate: '2026-10-06',
        scheduledTime: '',
      }).notifyCustomers ?? false,
    ).toBe(false);
    expect(skipRemainingSchema.parse({ date: '2026-10-01' }).notifyCustomers ?? false).toBe(
      false,
    );
  });
});
