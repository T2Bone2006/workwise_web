import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const sendExpoPushMessages = vi.fn();
const sendCustomerMessage = vi.fn();

vi.mock('@/lib/services/expo-push', () => ({
  sendExpoPushMessages: (...args: unknown[]) => sendExpoPushMessages(...args),
}));

vi.mock('@/lib/messaging/send', () => ({
  sendCustomerMessage: (...args: unknown[]) => sendCustomerMessage(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminClient,
}));

import { applyReplyOutcome, actOnReplyCore } from '@/lib/messaging/replies';

type Row = Record<string, unknown>;

type Filter =
  | { op: 'eq'; col: string; val: unknown }
  | { op: 'in'; col: string; val: unknown[] }
  | { op: 'is'; col: string; val: unknown }
  | { op: 'not-in'; col: string; val: unknown[] };

type Write = { tag: 'trader' | 'admin'; table: string; op: 'insert' | 'update'; payload: Row };

type FakeDb = {
  tables: Record<string, Row[]>;
  events: Write[];
  nextId: number;
};

const TENANT = 'tenant-a';
const CUSTOMER = 'cust-a';
const THREAD = 'thread-a';
const VISIT = '2025-10-02';
const LATER = '2099-06-01';

let db: FakeDb;
let adminClient: SupabaseClient;
let trader: SupabaseClient;

function matches(row: Row, filters: Filter[]): boolean {
  for (const filter of filters) {
    const value = row[filter.col];
    if (filter.op === 'eq' && value !== filter.val) return false;
    if (filter.op === 'in' && !filter.val.includes(value)) return false;
    if (filter.op === 'is' && (value ?? null) !== filter.val) return false;
    if (filter.op === 'not-in' && filter.val.includes(value)) return false;
  }
  return true;
}

function rowsOf(table: string): Row[] {
  if (!db.tables[table]) db.tables[table] = [];
  return db.tables[table];
}

function buildClient(tag: 'trader' | 'admin'): SupabaseClient {
  return {
    from(table: string) {
      const filters: Filter[] = [];
      let payload: Row | null = null;
      let op: 'select' | 'insert' | 'update' = 'select';
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitN: number | null = null;

      const run = (mode: 'many' | 'one') => {
        const rows = rowsOf(table);
        if (op === 'insert' && payload) {
          const stored = { ...payload, id: `id-${db.nextId++}` };
          rows.push(stored);
          db.events.push({ tag, table, op: 'insert', payload: stored });
          return { data: mode === 'one' ? { id: stored.id } : [stored], error: null };
        }
        const matched = rows.filter((row) => matches(row, filters));
        if (op === 'update' && payload) {
          for (const row of matched) Object.assign(row, payload);
          db.events.push({ tag, table, op: 'update', payload });
          return { data: mode === 'one' ? (matched[0] ?? null) : matched, error: null };
        }
        let selected = matched;
        if (orderCol) {
          const col = orderCol;
          selected = [...selected].sort((a, b) => {
            const cmp = String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0;
            return orderAsc ? cmp : -cmp;
          });
        }
        if (limitN != null) selected = selected.slice(0, limitN);
        return { data: mode === 'one' ? (selected[0] ?? null) : selected, error: null };
      };

      const builder = {
        select() {
          return builder;
        },
        insert(row: Row) {
          op = 'insert';
          payload = row;
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
        is(col: string, val: unknown) {
          filters.push({ op: 'is', col, val });
          return builder;
        },
        not(col: string, operator: string, val: unknown) {
          if (operator === 'in' && typeof val === 'string') {
            const list = val
              .replace(/[()]/g, '')
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean);
            filters.push({ op: 'not-in', col, val: list });
          }
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
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(run('many')).then(resolve, reject);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function job(id: string, overrides: Row = {}): Row {
  return {
    id,
    tenant_id: TENANT,
    status: 'assigned',
    scheduled_date: LATER,
    scheduled_time: null,
    route_position: 1,
    skip_reason: null,
    completion_notes: null,
    customer_confirmation_status: null,
    customer_requested_date: null,
    customer_reply_at: null,
    service_agreement_id: null,
    customer_id: CUSTOMER,
    ...overrides,
  };
}

function message(overrides: Row & { id: string }): Row {
  return {
    tenant_id: TENANT,
    thread_id: THREAD,
    direction: 'inbound',
    classification: 'said_no',
    job_ids: ['job-a', 'job-b'],
    requested_date: null,
    handled_at: null,
    created_at: '2026-09-28T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  db = {
    tables: {
      jobs: [],
      customers: [{ id: CUSTOMER, tenant_id: TENANT, name: 'Jane Smith', email: 'jane@example.com' }],
      workers: [
        {
          id: 'worker-1',
          primary_tenant_id: TENANT,
          worker_type: 'platform_solo',
          full_name: 'Sam',
          home_postcode: null,
          home_lat: null,
          home_lng: null,
          expo_push_token: 'ExponentPushToken[test]',
        },
      ],
      messages: [],
      message_threads: [
        {
          id: THREAD,
          tenant_id: TENANT,
          customer_id: CUSTOMER,
          status: 'needs_attention',
          needs_attention_reason: 'Said no',
          unread_count: 1,
        },
      ],
      visit_changes: [],
      job_status_history: [],
    },
    events: [],
    nextId: 1,
  };
  adminClient = buildClient('admin');
  trader = buildClient('trader');
  sendExpoPushMessages.mockReset();
  sendExpoPushMessages.mockResolvedValue(undefined);
  sendCustomerMessage.mockReset();
  sendCustomerMessage.mockResolvedValue({ outcome: 'text_sent', messageId: 'out-1' });
});

describe('applyReplyOutcome', () => {
  it('labels both jobs on a stop and pushes Said no', async () => {
    db.tables.jobs = [
      job('job-a', { scheduled_date: VISIT }),
      job('job-b', { scheduled_date: VISIT }),
    ];

    await applyReplyOutcome(adminClient, {
      tenantId: TENANT,
      threadId: THREAD,
      customerId: CUSTOMER,
      messageId: 'msg-1',
      intent: 'said_no',
      proposedDate: null,
      boundJobIds: ['job-a', 'job-b'],
      body: 'no thanks',
    });

    expect(db.tables.jobs).toEqual([
      expect.objectContaining({
        id: 'job-a',
        customer_confirmation_status: 'declined',
        customer_requested_date: null,
        customer_reply_at: expect.any(String),
      }),
      expect.objectContaining({
        id: 'job-b',
        customer_confirmation_status: 'declined',
        customer_requested_date: null,
      }),
    ]);
    expect(sendExpoPushMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        to: 'ExponentPushToken[test]',
        title: 'Jane Smith',
        body: 'Said no to Thu 2 Oct — tap to skip or keep',
        data: { type: 'rounds_message', threadId: THREAD, jobId: 'job-a' },
        sound: 'default',
      }),
    ]);
  });

  it('stores a requested date, and pushes a move with no date as the visit day only', async () => {
    db.tables.jobs = [job('job-a', { scheduled_date: VISIT })];

    await applyReplyOutcome(adminClient, {
      tenantId: TENANT,
      threadId: THREAD,
      customerId: CUSTOMER,
      messageId: 'msg-1',
      intent: 'asked_move',
      proposedDate: '2025-10-03',
      boundJobIds: ['job-a'],
      body: 'can you come friday?',
    });

    expect(db.tables.jobs[0]).toMatchObject({
      customer_confirmation_status: 'rescheduled',
      customer_requested_date: '2025-10-03',
    });

    sendExpoPushMessages.mockClear();
    await applyReplyOutcome(adminClient, {
      tenantId: TENANT,
      threadId: THREAD,
      customerId: CUSTOMER,
      messageId: 'msg-2',
      intent: 'asked_move',
      proposedDate: null,
      boundJobIds: ['job-a'],
      body: 'another day?',
    });

    expect(db.tables.jobs[0]).toMatchObject({
      customer_confirmation_status: 'rescheduled',
      customer_requested_date: null,
    });
    expect(sendExpoPushMessages).toHaveBeenCalledWith([
      expect.objectContaining({ body: 'Asked to move Thu 2 Oct' }),
    ]);
  });

  it('sends a thread-only push when no visit is linked', async () => {
    db.tables.jobs = [job('job-a', { customer_confirmation_status: null })];

    await applyReplyOutcome(adminClient, {
      tenantId: TENANT,
      threadId: THREAD,
      customerId: CUSTOMER,
      messageId: 'msg-1',
      intent: 'question',
      proposedDate: null,
      boundJobIds: [],
      body: 'what time?',
    });

    expect(db.tables.jobs[0]?.customer_confirmation_status).toBeNull();
    expect(sendExpoPushMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        title: 'Jane Smith',
        data: { type: 'rounds_message', threadId: THREAD },
      }),
    ]);
  });

  it('does not error when the worker has no push token', async () => {
    db.tables.workers[0]!.expo_push_token = null;
    db.tables.jobs = [job('job-a', { scheduled_date: VISIT })];

    await expect(
      applyReplyOutcome(adminClient, {
        tenantId: TENANT,
        threadId: THREAD,
        customerId: CUSTOMER,
        messageId: 'msg-1',
        intent: 'said_no',
        proposedDate: null,
        boundJobIds: ['job-a'],
        body: 'no',
      }),
    ).resolves.toBeUndefined();
    expect(sendExpoPushMessages).not.toHaveBeenCalled();
  });
});

describe('actOnReplyCore', () => {
  it('skips both services as one change and does not text the customer', async () => {
    db.tables.jobs = [
      job('job-a', { customer_confirmation_status: 'declined' }),
      job('job-b', { customer_confirmation_status: 'declined' }),
    ];
    db.tables.messages = [
      message({ id: 'msg-old', created_at: '2026-09-27T12:00:00.000Z', job_ids: ['job-a'] }),
      message({ id: 'msg-new', created_at: '2026-09-28T12:00:00.000Z', job_ids: ['job-a', 'job-b'] }),
    ];

    const result = await actOnReplyCore(trader, {
      tenantId: TENANT,
      actor: { userId: 'user-1' },
      threadId: THREAD,
      action: 'skip',
      letThemKnow: false,
    });

    expect(result).toEqual({ success: true, changeId: expect.any(String), acknowledged: false });
    expect(db.tables.visit_changes).toEqual([
      expect.objectContaining({
        kind: 'skip',
        job_ids: ['job-a', 'job-b'],
        notify_customers: false,
      }),
    ]);
    expect(db.events.filter((event) => event.table === 'visit_changes').map((event) => event.tag)).toEqual([
      'trader',
    ]);
    expect(db.tables.jobs.map((row) => row.customer_confirmation_status)).toEqual([null, null]);
    expect(db.tables.messages.map((row) => row.handled_action)).toEqual(['skipped', 'skipped']);
    expect(db.tables.message_threads[0]).toMatchObject({
      status: 'open',
      needs_attention_reason: null,
      unread_count: 0,
    });
    expect(sendCustomerMessage).not.toHaveBeenCalled();
  });

  it('asks for a date when a move has none', async () => {
    db.tables.jobs = [job('job-a')];
    db.tables.messages = [
      message({ id: 'msg-1', classification: 'asked_move', requested_date: null, job_ids: ['job-a'] }),
    ];

    const result = await actOnReplyCore(trader, {
      tenantId: TENANT,
      actor: { userId: 'user-1' },
      threadId: THREAD,
      action: 'move',
    });

    expect(result).toEqual({ success: false, error: 'Pick a date', code: 'needs_date' });
    expect(db.tables.visit_changes).toEqual([]);
    expect(db.tables.messages[0]?.handled_at).toBeNull();
  });

  it('clears labels on keep and leaves the visit where it is', async () => {
    db.tables.jobs = [
      job('job-a', {
        status: 'assigned',
        scheduled_date: LATER,
        customer_confirmation_status: 'declined',
        customer_requested_date: '2099-06-08',
        customer_reply_at: '2026-09-28T11:00:00.000Z',
      }),
    ];
    db.tables.messages = [message({ id: 'msg-1', job_ids: ['job-a'] })];

    const result = await actOnReplyCore(trader, {
      tenantId: TENANT,
      actor: { userId: 'user-1' },
      threadId: THREAD,
      action: 'keep',
    });

    expect(result).toEqual({ success: true, changeId: null, acknowledged: false });
    expect(db.tables.jobs[0]).toMatchObject({
      status: 'assigned',
      scheduled_date: LATER,
      customer_confirmation_status: null,
      customer_requested_date: null,
      customer_reply_at: null,
    });
    expect(db.tables.visit_changes).toEqual([]);
    expect(db.events).toContainEqual(
      expect.objectContaining({
        tag: 'trader',
        table: 'jobs',
        op: 'update',
        payload: {
          customer_confirmation_status: null,
          customer_requested_date: null,
          customer_reply_at: null,
        },
      }),
    );
    expect(db.tables.messages[0]).toMatchObject({ handled_action: 'kept' });
  });

  it('returns nothing to do once the reply is already handled', async () => {
    db.tables.messages = [message({ id: 'msg-1', job_ids: [], classification: 'question' })];

    const first = await actOnReplyCore(trader, {
      tenantId: TENANT,
      actor: { userId: 'user-1' },
      threadId: THREAD,
      action: 'dismiss',
    });
    const second = await actOnReplyCore(trader, {
      tenantId: TENANT,
      actor: { userId: 'user-1' },
      threadId: THREAD,
      action: 'dismiss',
    });

    expect(first).toEqual({ success: true, changeId: null, acknowledged: false });
    expect(second).toEqual({ success: false, error: 'Nothing to do', code: 'nothing_to_do' });
    expect(db.tables.messages[0]).toMatchObject({ handled_action: 'dismissed' });
  });
});
