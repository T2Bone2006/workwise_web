import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { InboundEvent } from '@/lib/messaging/provider';
import { UNKNOWN_NUMBER_SMS } from '@/lib/messaging/templates';

const sendText = vi.fn();
const leadReplies = vi.hoisted(() => ({
  handleLeadReply: vi.fn(async (..._args: unknown[]) => {
    void _args;
    return { handled: false as boolean, duplicate: false };
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => fakeAdmin,
}));

vi.mock('@/lib/lite/lead-replies', () => ({
  handleLeadReply: (...args: unknown[]) => leadReplies.handleLeadReply(...args),
}));

vi.mock('@/lib/messaging/provider', () => ({
  sendText: (...args: unknown[]) => sendText(...args),
  activeProvider: () => 'log' as const,
  ourNumber: () => '+447700900100',
}));

import { handleInboundText } from '@/lib/messaging/inbound';

type Row = Record<string, unknown>;

type Filter =
  | { op: 'eq'; col: string; val: unknown }
  | { op: 'in'; col: string; val: unknown[] };

type LimitRow = {
  phone: string;
  count: number;
  last_autoreply_at: string | null;
};

type FakeDb = {
  subscriptions: Row[];
  threads: Row[];
  customers: Row[];
  jobs: Row[];
  messages: Row[];
  optOuts: Row[];
  unrouted: Row[];
  liteTexts: Row[];
  limits: LimitRow[];
  failClassifyUpdate: boolean;
  clock: Date;
  nextMessage: number;
  nextUnrouted: number;
};

const PHONE = '+447700900003';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const NOW = new Date('2026-09-28T12:00:00.000Z');
const DAY_MS = 86_400_000;

let db: FakeDb;
let fakeAdmin: SupabaseClient;

function matches(row: Row, filters: Filter[]): boolean {
  for (const filter of filters) {
    const value = row[filter.col];
    if (filter.op === 'eq' && value !== filter.val) return false;
    if (filter.op === 'in' && !filter.val.includes(value)) return false;
  }
  return true;
}

function tableOf(name: string): Row[] {
  if (name === 'subscriptions') return db.subscriptions;
  if (name === 'message_threads') return db.threads;
  if (name === 'customers') return db.customers;
  if (name === 'jobs') return db.jobs;
  if (name === 'messages') return db.messages;
  if (name === 'messaging_opt_outs') return db.optOuts;
  if (name === 'messaging_unrouted_inbound') return db.unrouted;
  if (name === 'lite_texts') return db.liteTexts;
  return [];
}

function duplicateMessage(table: string, payload: Row): boolean {
  const key = payload.provider_message_id;
  if (typeof key !== 'string' || key === '') return false;
  const rows =
    table === 'messages' ? db.messages : table === 'messaging_unrouted_inbound' ? db.unrouted : [];
  return rows.some(
    (row) => row.provider === payload.provider && row.provider_message_id === key,
  );
}

function limitFor(phone: string): LimitRow {
  let row = db.limits.find((item) => item.phone === phone);
  if (!row) {
    row = { phone, count: 0, last_autoreply_at: null };
    db.limits.push(row);
  }
  return row;
}

function buildAdmin(): SupabaseClient {
  return {
    from(table: string) {
      const filters: Filter[] = [];
      let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
      let payload: Row | null = null;
      let orderCol: string | null = null;
      let orderAsc = true;
      let nullsFirst = false;
      let limitN: number | null = null;

      const run = (mode: 'many' | 'one') => {
        const rows = tableOf(table);
        if (op === 'insert' && payload) {
          if (duplicateMessage(table, payload)) {
            return { data: null, error: { code: '23505', message: 'duplicate' } };
          }
          const id =
            table === 'messages'
              ? `msg-${db.nextMessage++}`
              : table === 'messaging_unrouted_inbound'
                ? `unrouted-${db.nextUnrouted++}`
                : `row-${rows.length + 1}`;
          const stored: Row = { ...payload, id };
          if (table === 'messaging_unrouted_inbound' && stored.autoreplied == null) {
            stored.autoreplied = false;
          }
          rows.push(stored);
          return { data: mode === 'one' ? { id } : [stored], error: null };
        }
        if (op === 'upsert' && payload) {
          const phone = payload.phone_e164;
          const existing = rows.find((row) => row.phone_e164 === phone);
          if (existing) Object.assign(existing, payload);
          else rows.push({ ...payload });
          return { data: null, error: null };
        }
        if (op === 'delete') {
          const kept = rows.filter((row) => !matches(row, filters));
          rows.splice(0, rows.length, ...kept);
          return { data: null, error: null };
        }
        const matched = rows.filter((row) => matches(row, filters));
        if (op === 'update' && payload) {
          if (table === 'messages' && db.failClassifyUpdate) {
            return { data: null, error: { message: 'classify failed' } };
          }
          for (const row of matched) Object.assign(row, payload);
        }
        let selected = matched;
        if (op === 'select' && orderCol) {
          const col = orderCol;
          selected = [...selected].sort((a, b) => {
            const av = a[col];
            const bv = b[col];
            if (av == null && bv == null) return 0;
            if (av == null) return nullsFirst ? -1 : 1;
            if (bv == null) return nullsFirst ? 1 : -1;
            const cmp = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
            return orderAsc ? cmp : -cmp;
          });
        }
        if (op === 'select' && limitN != null) selected = selected.slice(0, limitN);
        return {
          data: mode === 'one' ? (selected[0] ?? null) : selected,
          error: null,
        };
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
        upsert(row: Row) {
          op = 'upsert';
          payload = row;
          return builder;
        },
        update(row: Row) {
          op = 'update';
          payload = row;
          return builder;
        },
        delete() {
          op = 'delete';
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
        order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
          orderCol = col;
          orderAsc = opts?.ascending !== false;
          nullsFirst = opts?.nullsFirst === true;
          return builder;
        },
        limit(n: number) {
          limitN = n;
          return builder;
        },
        single() {
          return Promise.resolve(run('one'));
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
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'messaging_count_inbound') {
        const row = limitFor(String(args.p_phone));
        const limit = typeof args.p_limit === 'number' ? args.p_limit : 10;
        row.count += 1;
        const isBlocked = row.count > limit;
        return Promise.resolve({
          data: [{ is_blocked: isBlocked, inbound_count: row.count }],
          error: null,
        });
      }
      if (name === 'messaging_claim_autoreply') {
        const row = limitFor(String(args.p_phone));
        const last = row.last_autoreply_at ? new Date(row.last_autoreply_at).getTime() : null;
        const due = last == null || last < db.clock.getTime() - 30 * DAY_MS;
        if (!due) return Promise.resolve({ data: false, error: null });
        row.last_autoreply_at = db.clock.toISOString();
        return Promise.resolve({ data: true, error: null });
      }
      if (name === 'messaging_note_inbound') {
        const thread = db.threads.find((item) => item.id === args.p_thread_id);
        if (thread) {
          thread.last_inbound_at = db.clock.toISOString();
          thread.unread_count = Number(thread.unread_count ?? 0) + 1;
          if (args.p_needs_attention === true) {
            thread.status = 'needs_attention';
            thread.needs_attention_reason = args.p_reason;
          }
        }
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
  } as unknown as SupabaseClient;
}

function rounds(tenantId: string): Row {
  return { tenant_id: tenantId, product: 'rounds', status: 'active' };
}

function thread(overrides: Row & { id: string }): Row {
  return {
    tenant_id: TENANT_A,
    customer_id: 'cust-a',
    customer_address: PHONE,
    channel: 'sms',
    status: 'open',
    unread_count: 0,
    active_job_ids: [],
    active_set_at: null,
    last_outbound_at: '2026-09-20T12:00:00.000Z',
    ...overrides,
  };
}

function customer(overrides: Row & { id: string }): Row {
  return {
    tenant_id: TENANT_A,
    phone_e164: PHONE,
    is_active: true,
    updated_at: '2026-09-01T00:00:00.000Z',
    messaging_opt_out_at: null,
    ...overrides,
  };
}

function inbound(overrides: Partial<InboundEvent> = {}): InboundEvent {
  return {
    kind: 'inbound',
    eventId: 'evt-1',
    providerMessageId: 'provider-1',
    from: PHONE,
    to: '+447700900100',
    body: 'hello',
    receivedAt: NOW.toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  db = {
    subscriptions: [rounds(TENANT_A)],
    threads: [thread({ id: 'thread-a' })],
    customers: [customer({ id: 'cust-a' }), customer({ id: 'cust-other', tenant_id: 'tenant-other' })],
    jobs: [],
    messages: [],
    optOuts: [],
    unrouted: [],
    liteTexts: [],
    limits: [],
    failClassifyUpdate: false,
    clock: NOW,
    nextMessage: 1,
    nextUnrouted: 1,
  };
  fakeAdmin = buildAdmin();
  leadReplies.handleLeadReply.mockReset();
  leadReplies.handleLeadReply.mockResolvedValue({ handled: false, duplicate: false });
  sendText.mockReset();
  sendText.mockResolvedValue({
    ok: true,
    provider: 'log',
    providerMessageId: 'log_1',
    segments: 1,
  });
});

describe('handleInboundText', () => {
  it('stores a lead reply and does not file it as unknown or auto-reply', async () => {
    db.threads = [];
    db.customers = [];
    leadReplies.handleLeadReply.mockResolvedValue({ handled: true, duplicate: false });

    const result = await handleInboundText(inbound({ body: "Thursday's good" }), NOW);

    expect(result).toEqual({ outcome: 'lead_reply' });
    expect(db.unrouted).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    expect(sendText).not.toHaveBeenCalled();
    expect(leadReplies.handleLeadReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        from: PHONE,
        body: "Thursday's good",
        providerMessageId: 'provider-1',
        keyword: null,
        at: NOW,
      }),
    );
  });

  it('treats a repeated lead-reply webhook as a duplicate and still does not auto-reply', async () => {
    db.threads = [];
    db.customers = [];
    leadReplies.handleLeadReply.mockResolvedValue({ handled: true, duplicate: true });

    const result = await handleInboundText(inbound(), NOW);

    expect(result).toEqual({ outcome: 'duplicate' });
    expect(db.unrouted).toHaveLength(0);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('does not count a redelivered lead reply toward the daily limit', async () => {
    db.threads = [];
    db.customers = [];
    leadReplies.handleLeadReply.mockImplementation(async () => {
      const stored = db.liteTexts.some((row) => row.provider_message_id === 'provider-1');
      if (!stored) {
        db.liteTexts.push({
          id: 'lite-1',
          provider: 'puresms',
          provider_message_id: 'provider-1',
        });
        return { handled: true, duplicate: false };
      }
      return { handled: true, duplicate: true };
    });

    expect(await handleInboundText(inbound({ body: "Thursday's good" }), NOW)).toEqual({
      outcome: 'lead_reply',
    });
    expect(await handleInboundText(inbound({ body: "Thursday's good" }), NOW)).toEqual({
      outcome: 'duplicate',
    });
    expect(db.limits).toEqual([expect.objectContaining({ phone: PHONE, count: 1 })]);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('routes a Rounds reply as before and never asks Lite', async () => {
    const result = await handleInboundText(inbound({ body: 'Thursday works' }), NOW);

    expect(result.outcome).toBe('recorded');
    expect(leadReplies.handleLeadReply).not.toHaveBeenCalled();
    expect(db.unrouted).toHaveLength(0);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('still blocks a spamming number before a lead reply is considered', async () => {
    db.threads = [];
    db.customers = [];
    db.limits = [{ phone: PHONE, count: 11, last_autoreply_at: null }];
    leadReplies.handleLeadReply.mockResolvedValue({ handled: true, duplicate: false });

    const result = await handleInboundText(inbound(), NOW);

    expect(result).toEqual({ outcome: 'blocked' });
    expect(leadReplies.handleLeadReply).not.toHaveBeenCalled();
    expect(db.unrouted).toHaveLength(0);
  });

  it('records STOP before forwarding a lead reply, and does not auto-reply', async () => {
    db.threads = [];
    db.customers = [];
    leadReplies.handleLeadReply.mockResolvedValue({ handled: true, duplicate: false });

    const result = await handleInboundText(inbound({ body: 'STOP' }), NOW);

    expect(result).toEqual({ outcome: 'lead_reply' });
    expect(db.optOuts).toEqual([
      expect.objectContaining({ phone_e164: PHONE, source: 'keyword', last_keyword: 'stop' }),
    ]);
    expect(leadReplies.handleLeadReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ keyword: 'opt_out' }),
    );
    expect(db.unrouted).toHaveLength(0);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('blocks the 11th text in a day and stores nothing for it', async () => {
    for (let n = 1; n <= 10; n += 1) {
      const result = await handleInboundText(
        inbound({ providerMessageId: `p-${n}`, eventId: `e-${n}`, body: 'hello' }),
        NOW,
      );
      expect(result.outcome).toBe('recorded');
    }

    const blocked = await handleInboundText(
      inbound({ providerMessageId: 'p-11', eventId: 'e-11', body: 'hello again' }),
      NOW,
    );

    expect(blocked).toEqual({ outcome: 'blocked' });
    expect(db.messages).toHaveLength(10);
    expect(db.unrouted).toHaveLength(0);
    expect(db.optOuts).toHaveLength(0);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('records STOP from a number that is already blocked', async () => {
    db.limits = [{ phone: PHONE, count: 11, last_autoreply_at: null }];

    const result = await handleInboundText(inbound({ body: 'STOP' }), NOW);

    expect(result).toEqual({ outcome: 'blocked' });
    expect(db.optOuts).toEqual([
      expect.objectContaining({
        phone_e164: PHONE,
        source: 'keyword',
        last_keyword: 'stop',
      }),
    ]);
    expect(db.customers.every((row) => typeof row.messaging_opt_out_at === 'string')).toBe(true);
    expect(db.messages).toHaveLength(0);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('records STOP for every customer with that phone and does not flag the thread', async () => {
    const result = await handleInboundText(inbound({ body: 'STOP' }), NOW);

    expect(result.outcome).toBe('opt_out');
    expect(db.optOuts).toEqual([
      expect.objectContaining({
        phone_e164: PHONE,
        source: 'keyword',
        last_keyword: 'stop',
      }),
    ]);
    expect(db.customers.every((row) => typeof row.messaging_opt_out_at === 'string')).toBe(true);
    expect(db.messages[0]).toMatchObject({
      classification: 'opt_out',
      kind: 'inbound',
      status: 'received',
    });
    expect(db.threads[0]).toMatchObject({ status: 'open' });
    expect(db.threads[0]?.needs_attention_reason).toBeUndefined();
    expect(sendText).not.toHaveBeenCalled();
  });

  it('removes a START opt-out from the global list and every customer', async () => {
    db.optOuts = [{ phone_e164: PHONE, source: 'keyword', last_keyword: 'stop' }];
    for (const row of db.customers) row.messaging_opt_out_at = '2026-09-01T00:00:00.000Z';

    const result = await handleInboundText(inbound({ body: 'Start' }), NOW);

    expect(result.outcome).toBe('opt_in');
    expect(db.optOuts).toEqual([]);
    expect(db.customers.every((row) => row.messaging_opt_out_at == null)).toBe(true);
    expect(db.messages[0]).toMatchObject({ classification: 'opt_in' });
    expect(sendText).not.toHaveBeenCalled();
  });

  it('flags the thread when classifyAndAct throws', async () => {
    db.failClassifyUpdate = true;

    const result = await handleInboundText(inbound({ body: 'hello' }), NOW);

    expect(result.outcome).toBe('recorded');
    expect(db.threads[0]).toMatchObject({
      status: 'needs_attention',
      needs_attention_reason: 'Sent a message',
    });
  });

  it('treats Cancel as said no and flags the thread', async () => {
    const result = await handleInboundText(inbound({ body: 'Cancel' }), NOW);

    expect(result.outcome).toBe('recorded');
    expect(db.optOuts).toEqual([]);
    expect(db.messages[0]).toMatchObject({
      classification: 'said_no',
      classification_confidence: 1,
    });
    expect(db.threads[0]).toMatchObject({
      status: 'needs_attention',
      needs_attention_reason: 'Said no',
    });
  });

  it('treats "no" after a payment text as about the payment, never a skip', async () => {
    db.messages.push({
      id: 'out-1',
      tenant_id: TENANT_A,
      thread_id: 'thread-a',
      customer_id: 'cust-a',
      direction: 'outbound',
      kind: 'chaser',
      status: 'sent',
      created_at: new Date(NOW.getTime() - 2 * DAY_MS).toISOString(),
    });

    const result = await handleInboundText(inbound({ body: 'No, I paid your lad cash' }), NOW);

    expect(result.outcome).toBe('recorded');
    const reply = db.messages.find((row) => row.direction === 'inbound');
    expect(reply?.classification).toBe('question');
    expect(db.threads[0]).toMatchObject({
      status: 'needs_attention',
      needs_attention_reason: 'About a payment',
    });
  });

  it('still treats "no" after a reminder as said no', async () => {
    db.messages.push({
      id: 'out-1',
      tenant_id: TENANT_A,
      thread_id: 'thread-a',
      customer_id: 'cust-a',
      direction: 'outbound',
      kind: 'reminder',
      status: 'sent',
      created_at: new Date(NOW.getTime() - DAY_MS).toISOString(),
    });

    await handleInboundText(inbound({ body: 'Cancel' }), NOW);

    expect(db.threads[0]).toMatchObject({ needs_attention_reason: 'Said no' });
  });

  it('replies once to an unknown number, then not again until 31 days later', async () => {
    db.threads = [];
    db.customers = [];
    const firstAt = new Date('2026-09-01T12:00:00.000Z');
    const nextDay = new Date('2026-09-02T12:00:00.000Z');
    const later = new Date(firstAt.getTime() + 31 * DAY_MS);

    db.clock = firstAt;
    const first = await handleInboundText(
      inbound({
        providerMessageId: 'u-1',
        eventId: 'u-1',
        body: 'x'.repeat(2000),
      }),
      firstAt,
    );
    expect(first.outcome).toBe('unknown_autoreplied');
    expect(db.unrouted[0]?.body).toHaveLength(1600);
    expect(db.unrouted[0]?.autoreplied).toBe(true);
    expect(db.messages).toHaveLength(0);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({
      to: PHONE,
      body: UNKNOWN_NUMBER_SMS,
      clientReference: 'unrouted-1',
    });

    db.clock = nextDay;
    const second = await handleInboundText(
      inbound({ providerMessageId: 'u-2', eventId: 'u-2', body: 'hello again' }),
      nextDay,
    );
    expect(second.outcome).toBe('unknown_stored');
    expect(db.unrouted[1]?.autoreplied).toBe(false);
    expect(sendText).toHaveBeenCalledTimes(1);

    db.clock = later;
    const third = await handleInboundText(
      inbound({ providerMessageId: 'u-3', eventId: 'u-3', body: 'hello later' }),
      later,
    );
    expect(third.outcome).toBe('unknown_autoreplied');
    expect(db.unrouted[2]?.autoreplied).toBe(true);
    expect(sendText).toHaveBeenCalledTimes(2);
  });

  it('treats the same provider message id as a duplicate', async () => {
    const event = inbound({ providerMessageId: 'same-id', eventId: 'same-id' });
    const first = await handleInboundText(event, NOW);
    const second = await handleInboundText(event, NOW);

    expect(first.outcome).toBe('recorded');
    expect(second.outcome).toBe('duplicate');
    expect(db.messages).toHaveLength(1);
    expect(db.threads[0]?.unread_count).toBe(1);
  });

  it('routes to the Rounds business that texted this number most recently', async () => {
    db.subscriptions = [rounds(TENANT_A), rounds(TENANT_B)];
    db.threads = [
      thread({
        id: 'thread-pro',
        tenant_id: 'pro-tenant',
        customer_id: 'cust-pro',
        last_outbound_at: '2026-09-27T12:00:00.000Z',
      }),
      thread({
        id: 'thread-a',
        tenant_id: TENANT_A,
        customer_id: 'cust-a',
        last_outbound_at: '2026-09-01T12:00:00.000Z',
      }),
      thread({
        id: 'thread-b',
        tenant_id: TENANT_B,
        customer_id: 'cust-b',
        last_outbound_at: '2026-09-20T12:00:00.000Z',
      }),
    ];

    const result = await handleInboundText(inbound({ body: 'hello' }), NOW);

    expect(result.outcome).toBe('recorded');
    expect(db.messages[0]).toMatchObject({
      tenant_id: TENANT_B,
      thread_id: 'thread-b',
      customer_id: 'cust-b',
    });
  });

  it('links a reply to a stop texted in the last week, and not to an older one', async () => {
    db.jobs = [
      {
        id: 'job-thu',
        tenant_id: TENANT_A,
        status: 'assigned',
        scheduled_date: '2026-10-01',
      },
    ];
    db.threads = [
      thread({
        id: 'thread-a',
        active_job_ids: ['job-thu'],
        active_set_at: new Date(NOW.getTime() - 2 * DAY_MS).toISOString(),
      }),
    ];

    const recent = await handleInboundText(
      inbound({ providerMessageId: 'recent', eventId: 'recent', body: 'hello' }),
      NOW,
    );
    expect(recent.outcome).toBe('recorded');
    expect(db.messages[0]).toMatchObject({
      job_id: 'job-thu',
      job_ids: ['job-thu'],
    });

    db.threads[0]!.active_set_at = new Date(NOW.getTime() - 9 * DAY_MS).toISOString();
    const old = await handleInboundText(
      inbound({ providerMessageId: 'old', eventId: 'old', body: 'hello' }),
      NOW,
    );
    expect(old.outcome).toBe('recorded');
    expect(db.messages[1]).toMatchObject({ job_id: null, job_ids: [] });
  });
});
