import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendCustomerMessageInput } from '@/lib/messaging/send';

const sendText = vi.fn();
const activeProvider = vi.fn(() => 'log' as const);
const ourNumber = vi.fn(() => '+447700900100');

vi.mock('@/lib/messaging/provider', () => ({
  sendText: (...args: unknown[]) => sendText(...args),
  activeProvider: () => activeProvider(),
  ourNumber: () => ourNumber(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => fakeAdmin,
}));

const listRoundsTenantIds = vi.fn(async () => ['tenant-1']);
vi.mock('@/lib/messaging/rounds-tenants', () => ({
  listRoundsTenantIds: () => listRoundsTenantIds(),
}));

type MessageRow = Record<string, unknown> & { id: string };
type CustomerRow = {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone_e164: string | null;
  preferred_channel: string | null;
  messaging_opt_in_at: string | null;
  is_active: boolean;
};

type FakeDb = {
  customers: CustomerRow[];
  tenants: {
    id: string;
    name: string;
    settings: Record<string, unknown>;
  }[];
  threads: {
    id: string;
    tenant_id: string;
    customer_id: string;
    channel: string;
    customer_address: string | null;
    active_job_ids?: string[];
    active_set_at?: string | null;
    last_outbound_at?: string | null;
  }[];
  messages: MessageRow[];
  jobs: {
    id: string;
    tenant_id: string;
    status: string;
    scheduled_date: string;
  }[];
  optOuts: string[];
  optOutError: { message: string } | null;
  creditFrom: string;
  creditError: { message: string } | null;
  claimCalls: { p_segments: number }[];
  refundCalls: {
    p_segments: number;
    p_from: string;
    p_month: string;
  }[];
  nextMessageId: number;
  nextThreadId: number;
};

let db: FakeDb;
let fakeAdmin: ReturnType<typeof buildFakeAdmin>;

function buildFakeAdmin() {
  return {
    from(table: string) {
      return tableQuery(table);
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'claim_text_credits') {
        db.claimCalls.push({ p_segments: args.p_segments as number });
        if (db.creditError) {
          return Promise.resolve({ data: null, error: db.creditError });
        }
        return Promise.resolve({ data: db.creditFrom, error: null });
      }
      if (name === 'refund_text_credits') {
        db.refundCalls.push({
          p_segments: args.p_segments as number,
          p_from: args.p_from as string,
          p_month: args.p_month as string,
        });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
  };
}

function tableQuery(table: string) {
  const state: {
    filters: { col: string; op: string; val: unknown }[];
    payload: Record<string, unknown> | null;
    orderCol: string | null;
    limitN: number | null;
  } = {
    filters: [],
    payload: null,
    orderCol: null,
    limitN: null,
  };

  const api: Record<string, unknown> = {
    select(_cols?: string) {
      void _cols;
      return api;
    },
    insert(payload: Record<string, unknown>) {
      state.payload = payload;
      return {
        select(_c?: string) {
          void _c;
          return {
            single: async () => {
              if (table === 'messages') {
                const dedupe = payload.dedupe_key as string;
                if (
                  db.messages.some(
                    (m) =>
                      m.tenant_id === payload.tenant_id &&
                      m.dedupe_key === dedupe,
                  )
                ) {
                  return {
                    data: null,
                    error: { code: '23505', message: 'duplicate' },
                  };
                }
                const id = `msg-${db.nextMessageId++}`;
                const row = { id, ...payload };
                db.messages.push(row);
                return { data: { id }, error: null };
              }
              return { data: null, error: { message: 'unexpected insert' } };
            },
          };
        },
      };
    },
    upsert(payload: Record<string, unknown>) {
      state.payload = payload;
      return {
        select(_c?: string) {
          void _c;
          return {
            single: async () => {
              if (table !== 'message_threads') {
                return { data: null, error: { message: 'bad upsert' } };
              }
              const existing = db.threads.find(
                (t) =>
                  t.tenant_id === payload.tenant_id &&
                  t.customer_id === payload.customer_id &&
                  t.channel === payload.channel,
              );
              if (existing) {
                if (typeof payload.customer_address === 'string') {
                  existing.customer_address = payload.customer_address;
                }
                return { data: { id: existing.id }, error: null };
              }
              const id = `thr-${db.nextThreadId++}`;
              db.threads.push({
                id,
                tenant_id: payload.tenant_id as string,
                customer_id: payload.customer_id as string,
                channel: payload.channel as string,
                customer_address:
                  (payload.customer_address as string | undefined) ?? null,
              });
              return { data: { id }, error: null };
            },
          };
        },
      };
    },
    update(payload: Record<string, unknown>) {
      state.payload = payload;
      const chain = (): Record<string, unknown> => ({
        eq(col: string, val: unknown) {
          state.filters.push({ col, op: 'eq', val });
          return Object.assign(chain(), thenableUpdate(table, state));
        },
        is(col: string, val: unknown) {
          state.filters.push({ col, op: 'is', val });
          return Object.assign(chain(), thenableUpdate(table, state));
        },
        select(_c?: string) {
          void _c;
          return {
            maybeSingle: async () => {
              const result = await finishUpdate(table, state.filters, payload);
              if (result.error) return { data: null, error: result.error };
              const matched = result.matched;
              if (!matched) return { data: null, error: null };
              return { data: { id: matched.id }, error: null };
            },
            single: async () => {
              const result = await finishUpdate(table, state.filters, payload);
              if (result.error) return { data: null, error: result.error };
              const matched = result.matched;
              if (!matched) {
                return { data: null, error: { message: 'not found' } };
              }
              return { data: { id: matched.id }, error: null };
            },
          };
        },
      });
      return Object.assign(chain(), thenableUpdate(table, state));
    },
    eq(col: string, val: unknown) {
      state.filters.push({ col, op: 'eq', val });
      return Object.assign(api, thenableList(table, state));
    },
    is(col: string, val: unknown) {
      state.filters.push({ col, op: 'is', val });
      return Object.assign(api, thenableList(table, state));
    },
    lte(col: string, val: unknown) {
      state.filters.push({ col, op: 'lte', val });
      return Object.assign(api, thenableList(table, state));
    },
    gte(col: string, val: unknown) {
      state.filters.push({ col, op: 'gte', val });
      return Object.assign(api, thenableList(table, state));
    },
    in(col: string, val: unknown) {
      state.filters.push({ col, op: 'in', val });
      return Object.assign(api, thenableList(table, state));
    },
    order(col: string) {
      state.orderCol = col;
      return Object.assign(api, thenableList(table, state));
    },
    limit(n: number) {
      state.limitN = n;
      return finishListSelect(table, state);
    },
    maybeSingle: async () => finishSelect(table, state.filters, true),
    single: async () => finishSelect(table, state.filters, false),
  };

  return api;
}

function thenableList(
  table: string,
  state: {
    filters: { col: string; op: string; val: unknown }[];
    orderCol: string | null;
    limitN: number | null;
  },
) {
  return {
    then(
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) {
      return finishListSelect(table, state).then(resolve, reject);
    },
  };
}

function thenableUpdate(
  table: string,
  state: {
    filters: { col: string; op: string; val: unknown }[];
    payload: Record<string, unknown> | null;
  },
) {
  const run = () =>
    finishUpdate(table, state.filters, state.payload ?? {}).then((r) => ({
      data: null,
      error: r.error,
    }));
  return {
    then(
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) {
      return run().then(resolve, reject);
    },
  };
}

async function finishUpdate(
  table: string,
  filters: { col: string; op: string; val: unknown }[],
  payload: Record<string, unknown>,
): Promise<{ matched: { id: string } | null; error: null }> {
  if (table === 'messages') {
    const id = filters.find((f) => f.col === 'id')?.val;
    const row = db.messages.find((m) => m.id === id);
    if (!row) return { matched: null, error: null };
    for (const f of filters) {
      if (f.col === 'id') continue;
      if (f.op === 'eq' && row[f.col] !== f.val) {
        return { matched: null, error: null };
      }
      if (f.op === 'is') {
        const cur = row[f.col];
        if (f.val == null && cur != null) return { matched: null, error: null };
        if (f.val != null && cur !== f.val) return { matched: null, error: null };
      }
    }
    Object.assign(row, payload);
    return { matched: { id: row.id }, error: null };
  }
  if (table === 'message_threads') {
    const id = filters.find((f) => f.col === 'id')?.val;
    const row = db.threads.find((t) => t.id === id);
    if (row) Object.assign(row, payload);
    return { matched: row ? { id: row.id } : null, error: null };
  }
  if (table === 'customers') {
    const id = filters.find((f) => f.col === 'id')?.val;
    const tenantId = filters.find((f) => f.col === 'tenant_id')?.val;
    const row = db.customers.find(
      (c) => c.id === id && c.tenant_id === tenantId,
    );
    if (row) {
      const onlyNull = filters.some(
        (f) => f.col === 'messaging_opt_in_at' && f.op === 'is' && f.val == null,
      );
      if (onlyNull && row.messaging_opt_in_at != null) {
        return { matched: null, error: null };
      }
      Object.assign(row, payload);
      return { matched: { id: row.id }, error: null };
    }
    return { matched: null, error: null };
  }
  return { matched: null, error: null };
}

async function finishListSelect(
  table: string,
  state: {
    filters: { col: string; op: string; val: unknown }[];
    orderCol: string | null;
    limitN: number | null;
  },
) {
  if (table === 'messages') {
    let rows = [...db.messages];
    for (const f of state.filters) {
      if (f.op === 'eq') {
        rows = rows.filter((m) => m[f.col] === f.val);
      } else if (f.op === 'lte') {
        rows = rows.filter(
          (m) =>
            typeof m[f.col] === 'string' &&
            (m[f.col] as string) <= (f.val as string),
        );
      } else if (f.op === 'gte') {
        rows = rows.filter(
          (m) =>
            typeof m[f.col] === 'string' &&
            (m[f.col] as string) >= (f.val as string),
        );
      } else if (f.op === 'in') {
        const set = new Set(f.val as unknown[]);
        rows = rows.filter((m) => set.has(m[f.col]));
      }
    }
    if (state.orderCol) {
      const col = state.orderCol;
      rows.sort((a, b) =>
        String(a[col] ?? '').localeCompare(String(b[col] ?? '')),
      );
    }
    if (state.limitN != null) rows = rows.slice(0, state.limitN);
    return { data: rows, error: null };
  }
  if (table === 'jobs') {
    let rows = [...db.jobs];
    for (const f of state.filters) {
      if (f.op === 'eq') {
        rows = rows.filter((j) => (j as Record<string, unknown>)[f.col] === f.val);
      } else if (f.op === 'in') {
        const set = new Set(f.val as string[]);
        rows = rows.filter((j) => set.has(j.id));
      }
    }
    return { data: rows, error: null };
  }
  return { data: [], error: null };
}

async function finishSelect(
  table: string,
  filters: { col: string; op: string; val: unknown }[],
  maybe: boolean,
) {
  if (table === 'customers') {
    const id = filters.find((f) => f.col === 'id')?.val;
    const tenantId = filters.find((f) => f.col === 'tenant_id')?.val;
    const row = db.customers.find(
      (c) => c.id === id && c.tenant_id === tenantId,
    );
    return { data: row ?? null, error: null };
  }
  if (table === 'tenants') {
    const id = filters.find((f) => f.col === 'id')?.val;
    const row = db.tenants.find((t) => t.id === id);
    return { data: row ?? null, error: null };
  }
  if (table === 'messaging_opt_outs') {
    if (db.optOutError) {
      return { data: null, error: db.optOutError };
    }
    const phone = filters.find((f) => f.col === 'phone_e164')?.val;
    const hit = db.optOuts.includes(phone as string)
      ? { phone_e164: phone }
      : null;
    return { data: hit, error: null };
  }
  if (table === 'messages') {
    const id = filters.find((f) => f.col === 'id')?.val;
    const row = db.messages.find((m) => m.id === id) ?? null;
    return { data: row, error: null };
  }
  if (table === 'jobs') {
    return finishListSelect(table, {
      filters,
      orderCol: null,
      limitN: null,
    });
  }
  if (table === 'message_threads') {
    return { data: null, error: null };
  }
  return {
    data: null,
    error: maybe ? null : { message: `unexpected select ${table}` },
  };
}

const TENANT = 'tenant-1';
const CUSTOMER = 'cust-1';

function baseCustomer(over: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: CUSTOMER,
    tenant_id: TENANT,
    name: 'Alex',
    email: 'alex@example.com',
    phone_e164: '+447700900123',
    preferred_channel: null,
    messaging_opt_in_at: '2026-01-01T00:00:00.000Z',
    is_active: true,
    ...over,
  };
}

function resetDb(over: Partial<FakeDb> = {}) {
  db = {
    customers: [baseCustomer()],
    tenants: [
      {
        id: TENANT,
        name: 'Sparkle Clean',
        settings: {
          messaging: {
            money_channel: 'email_first',
            change_channel: 'text_first',
          },
          company: { email: 'hello@sparkle.test', phone: '020 7946 0958' },
        },
      },
    ],
    threads: [],
    messages: [],
    jobs: [],
    optOuts: [],
    optOutError: null,
    creditFrom: 'allowance',
    creditError: null,
    claimCalls: [],
    refundCalls: [],
    nextMessageId: 1,
    nextThreadId: 1,
    ...over,
  };
  fakeAdmin = buildFakeAdmin();
}

async function loadSend() {
  return import('@/lib/messaging/send');
}

describe('sendCustomerMessage', () => {
  beforeEach(() => {
    vi.resetModules();
    sendText.mockReset();
    sendText.mockResolvedValue({
      ok: true,
      provider: 'log',
      providerMessageId: 'log_abc',
      segments: 1,
    });
    activeProvider.mockReturnValue('log');
    ourNumber.mockReturnValue('+447700900100');
    listRoundsTenantIds.mockReset();
    listRoundsTenantIds.mockResolvedValue([TENANT]);
    resetDb();
  });

  it('1. same dedupeKey twice → duplicate; provider and credits untouched on second', async () => {
    const { sendCustomerMessage } = await loadSend();
    const input: SendCustomerMessageInput = {
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_change',
      dedupeKey: 'change:vc1:job1',
      text: () => 'We had to move your visit.',
      email: async () => ({ sent: true }),
      jobIds: ['job1'],
      now: new Date('2026-09-15T13:00:00.000Z'), // 14:00 BST
    };
    const first = await sendCustomerMessage(input);
    expect(first.outcome).toBe('text_sent');
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(db.claimCalls).toHaveLength(1);

    sendText.mockClear();
    db.claimCalls = [];
    const second = await sendCustomerMessage(input);
    expect(second).toEqual({ outcome: 'duplicate' });
    expect(sendText).not.toHaveBeenCalled();
    expect(db.claimCalls).toHaveLength(0);
  });

  it('2. money kind, email_first, has email → email sent, no credits', async () => {
    const { sendCustomerMessage } = await loadSend();
    const email = vi.fn(async () => ({ sent: true }));
    const result = await sendCustomerMessage({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'payment_received',
      dedupeKey: 'payment_received:pay1',
      text: () => 'Thanks for paying.',
      email,
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(result.outcome).toBe('email_sent');
    expect(email).toHaveBeenCalledOnce();
    expect(sendText).not.toHaveBeenCalled();
    expect(db.claimCalls).toHaveLength(0);
    expect(db.messages[0]?.channel).toBe('email');
  });

  it('3. change kind, text first, daytime → text_sent; credits claimed; opt-in set; thread bound', async () => {
    resetDb({
      customers: [baseCustomer({ messaging_opt_in_at: null })],
    });
    const { sendCustomerMessage } = await loadSend();
    const result = await sendCustomerMessage({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_change',
      dedupeKey: 'change:vc2:job2',
      text: () => 'Your visit is moving to Friday.',
      email: async () => ({ sent: true }),
      jobIds: ['job2', 'job2b'],
      bindThread: true,
      now: new Date('2026-09-15T13:00:00.000Z'), // 14:00 London BST
    });
    expect(result).toEqual({ outcome: 'text_sent', messageId: 'msg-1' });
    expect(db.claimCalls).toEqual([{ p_segments: 1 }]);
    expect(db.customers[0]?.messaging_opt_in_at).toBeTruthy();
    expect(db.threads[0]?.active_job_ids).toEqual(['job2', 'job2b']);
    expect(db.threads[0]?.active_set_at).toBeTruthy();
    expect(sendText).toHaveBeenCalledOnce();
  });

  it('4. same at 22:30 London → text_held; provider not called', async () => {
    const { sendCustomerMessage } = await loadSend();
    // 2026-09-15 21:30 UTC = 22:30 BST
    const now = new Date('2026-09-15T21:30:00.000Z');
    const result = await sendCustomerMessage({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_change',
      dedupeKey: 'change:vc3:job3',
      text: () => 'Moved.',
      email: null,
      now,
    });
    expect(result.outcome).toBe('text_held');
    expect(sendText).not.toHaveBeenCalled();
    const row = db.messages[0];
    expect(row?.status).toBe('held');
    expect(row?.hold_until).toBe(
      // next 07:00 London = 2026-09-16 06:00 UTC (BST)
      new Date('2026-09-16T06:00:00.000Z').toISOString(),
    );
  });

  it('5. opted out → email if present; skipped opted_out with no email', async () => {
    resetDb({ optOuts: ['+447700900123'] });
    const { sendCustomerMessage } = await loadSend();
    const withEmail = await sendCustomerMessage({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_change',
      dedupeKey: 'change:vc4:job4',
      text: () => 'Moved.',
      email: async () => ({ sent: true }),
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(withEmail.outcome).toBe('email_sent');
    expect(sendText).not.toHaveBeenCalled();
    expect(db.claimCalls).toHaveLength(0);

    resetDb({
      optOuts: ['+447700900123'],
      customers: [baseCustomer({ email: null })],
    });
    const { sendCustomerMessage: send2 } = await loadSend();
    const noEmail = await send2({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_change',
      dedupeKey: 'change:vc5:job5',
      text: () => 'Moved.',
      email: async () => ({ sent: true }),
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(noEmail).toMatchObject({
      outcome: 'skipped',
      reason: 'opted_out',
    });
  });

  it('6. no texts left → email if possible; reminder → skipped no_texts_left', async () => {
    resetDb({ creditFrom: 'none' });
    const { sendCustomerMessage } = await loadSend();
    const emailed = await sendCustomerMessage({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_change',
      dedupeKey: 'change:vc6:job6',
      text: () => 'Moved.',
      email: async () => ({ sent: true }),
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(emailed.outcome).toBe('email_sent');
    expect(sendText).not.toHaveBeenCalled();

    resetDb({ creditFrom: 'none' });
    const { sendCustomerMessage: send2 } = await loadSend();
    const reminder = await send2({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'reminder',
      dedupeKey: 'reminder:20260918:job7',
      text: ({ firstText }) =>
        firstText ? 'Visit soon. Reply STOP to opt out.' : 'Visit soon.',
      email: null,
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(reminder).toMatchObject({
      outcome: 'skipped',
      reason: 'no_texts_left',
    });
  });

  it('7. provider not ok → credits refunded, then email tried', async () => {
    sendText.mockResolvedValue({
      ok: false,
      provider: 'log',
      error: 'PureSMS 500: boom',
      retryable: true,
    });
    const { sendCustomerMessage } = await loadSend();
    const email = vi.fn(async () => ({ sent: true }));
    const result = await sendCustomerMessage({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_change',
      dedupeKey: 'change:vc8:job8',
      text: () => 'Moved.',
      email,
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(result.outcome).toBe('email_sent');
    expect(db.refundCalls).toHaveLength(1);
    expect(db.refundCalls[0]?.p_from).toBe('allowance');
    expect(db.refundCalls[0]?.p_month).toBe('2026-09');
    expect(email).toHaveBeenCalledOnce();
  });

  it("8. preferred_channel 'none' → skipped no_messages, no row", async () => {
    resetDb({
      customers: [baseCustomer({ preferred_channel: 'none' })],
    });
    const { sendCustomerMessage } = await loadSend();
    const result = await sendCustomerMessage({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_done',
      dedupeKey: 'visit_done:job9',
      text: () => 'Visit done.',
      email: async () => ({ sent: true }),
    });
    expect(result).toEqual({ outcome: 'skipped', reason: 'no_messages' });
    expect(db.messages).toHaveLength(0);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('9. landline is treated as no mobile', async () => {
    resetDb({
      customers: [
        baseCustomer({
          phone_e164: '+441132960001',
          preferred_channel: 'sms',
          email: null,
        }),
      ],
      tenants: [
        {
          id: TENANT,
          name: 'Sparkle Clean',
          settings: {
            messaging: {
              money_channel: 'email_first',
              change_channel: 'text_first',
            },
          },
        },
      ],
    });
    const { sendCustomerMessage } = await loadSend();
    const result = await sendCustomerMessage({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_change',
      dedupeKey: 'change:vc10:job10',
      text: () => 'Moved.',
      email: null,
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(result).toMatchObject({
      outcome: 'skipped',
      reason: 'no_channel',
    });
    expect(sendText).not.toHaveBeenCalled();
    expect(db.claimCalls).toHaveLength(0);
  });

  it('10. firstText is true only when messaging_opt_in_at is null', async () => {
    const seen: boolean[] = [];
    resetDb({
      customers: [baseCustomer({ messaging_opt_in_at: null })],
    });
    const { sendCustomerMessage } = await loadSend();
    await sendCustomerMessage({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'reminder',
      dedupeKey: 'reminder:20260920:job11',
      text: ({ firstText }) => {
        seen.push(firstText);
        return firstText
          ? 'Visit Fri. Reply STOP to opt out.'
          : 'Visit Fri.';
      },
      email: null,
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(seen).toEqual([true]);

    seen.length = 0;
    resetDb({
      customers: [
        baseCustomer({ messaging_opt_in_at: '2026-01-01T00:00:00.000Z' }),
      ],
    });
    const { sendCustomerMessage: send2 } = await loadSend();
    await send2({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'reminder',
      dedupeKey: 'reminder:20260921:job12',
      text: ({ firstText }) => {
        seen.push(firstText);
        return firstText
          ? 'Visit Fri. Reply STOP to opt out.'
          : 'Visit Fri.';
      },
      email: null,
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(seen).toEqual([false]);
  });

  it('R1. provider refused + no email → failed with provider error (not skipped)', async () => {
    sendText.mockResolvedValue({
      ok: false,
      provider: 'log',
      error: 'PureSMS 500: boom',
      retryable: true,
    });
    resetDb({
      customers: [baseCustomer({ email: null })],
    });
    const { sendCustomerMessage } = await loadSend();
    const result = await sendCustomerMessage({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_change',
      dedupeKey: 'change:vc-r1:job',
      text: () => 'Moved.',
      email: null,
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(result).toEqual({
      outcome: 'failed',
      messageId: 'msg-1',
      error: 'PureSMS 500: boom',
    });
    expect(db.messages[0]?.status).toBe('failed');
    expect(db.messages[0]?.error).toBe('PureSMS 500: boom');
    expect(db.refundCalls).toHaveLength(1);
  });

  it('R2. isOptedOut lookup error fails closed → skipped opted_out', async () => {
    resetDb({
      optOutError: { message: 'db down' },
      customers: [baseCustomer({ email: null })],
    });
    const { sendCustomerMessage } = await loadSend();
    const result = await sendCustomerMessage({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_change',
      dedupeKey: 'change:vc-r2:job',
      text: () => 'Moved.',
      email: null,
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(result).toMatchObject({
      outcome: 'skipped',
      reason: 'opted_out',
    });
    expect(sendText).not.toHaveBeenCalled();
    expect(db.claimCalls).toHaveLength(0);
  });

  it('R3. claim_text_credits error skips text and tries email; outer catch marks claimed row failed', async () => {
    resetDb({
      creditError: { message: 'credits rpc failed' },
    });
    const { sendCustomerMessage } = await loadSend();
    const email = vi.fn(async () => ({ sent: true }));
    const emailed = await sendCustomerMessage({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_change',
      dedupeKey: 'change:vc-r3a:job',
      text: () => 'Moved.',
      email,
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(emailed.outcome).toBe('email_sent');
    expect(email).toHaveBeenCalledOnce();
    expect(sendText).not.toHaveBeenCalled();

    resetDb();
    const { sendCustomerMessage: send2 } = await loadSend();
    const boom = await send2({
      tenantId: TENANT,
      customerId: CUSTOMER,
      kind: 'visit_change',
      dedupeKey: 'change:vc-r3b:job',
      text: () => {
        throw new Error('template blew up');
      },
      email: null,
      now: new Date('2026-09-15T13:00:00.000Z'),
    });
    expect(boom).toMatchObject({
      outcome: 'failed',
      messageId: 'msg-1',
      error: 'template blew up',
    });
    expect(db.messages[0]?.status).toBe('failed');
    expect(db.messages[0]?.error).toBe('template blew up');
  });

  it('R4b. held reminder whose job moved date → skipped visit_changed + credits refunded', async () => {
    resetDb({
      threads: [
        {
          id: 'thr-rem',
          tenant_id: TENANT,
          customer_id: CUSTOMER,
          channel: 'sms',
          customer_address: '+447700900123',
        },
      ],
      jobs: [
        {
          id: 'job-moved',
          tenant_id: TENANT,
          status: 'assigned',
          scheduled_date: '2026-10-05',
        },
      ],
      messages: [
        {
          id: 'held-rem',
          tenant_id: TENANT,
          thread_id: 'thr-rem',
          customer_id: CUSTOMER,
          kind: 'reminder',
          body: 'Acme: we\'re due…',
          to_address: '+447700900123',
          segments: 1,
          billed_from: 'allowance',
          billed_month: '2026-09',
          job_id: 'job-moved',
          job_ids: ['job-moved'],
          // Format written by reminders.ts (YYYY-MM-DD), not YYYYMMDD.
          dedupe_key: 'reminder:2026-10-01:job-moved',
          status: 'held',
          hold_until: '2026-09-16T06:00:00.000Z',
        },
      ],
    });

    const { sendHeldMessages } = await loadSend();
    const counts = await sendHeldMessages(
      new Date('2026-09-16T07:00:00.000Z'),
    );

    expect(sendText).not.toHaveBeenCalled();
    expect(counts.skipped).toBe(1);
    expect(db.messages.find((m) => m.id === 'held-rem')).toMatchObject({
      status: 'skipped',
      error: 'visit_changed',
    });
    expect(db.refundCalls).toEqual([
      { p_segments: 1, p_from: 'allowance', p_month: '2026-09' },
    ]);
  });

  it('R4. sendHeldMessages claims held→queued; a row already claimed is skipped', async () => {
    resetDb({
      threads: [
        {
          id: 'thr-held',
          tenant_id: TENANT,
          customer_id: CUSTOMER,
          channel: 'sms',
          customer_address: '+447700900123',
        },
      ],
      messages: [
        {
          id: 'held-1',
          tenant_id: TENANT,
          thread_id: 'thr-held',
          customer_id: CUSTOMER,
          kind: 'visit_change',
          body: 'Held text',
          to_address: '+447700900123',
          segments: 1,
          billed_from: 'allowance',
          billed_month: '2026-09',
          job_id: null,
          job_ids: [],
          dedupe_key: 'change:held:job',
          status: 'held',
          hold_until: '2026-09-16T06:00:00.000Z',
        },
        {
          id: 'held-3',
          tenant_id: TENANT,
          thread_id: 'thr-held',
          customer_id: CUSTOMER,
          kind: 'visit_change',
          body: 'Race',
          to_address: '+447700900123',
          segments: 1,
          billed_from: 'allowance',
          billed_month: '2026-09',
          job_id: null,
          job_ids: [],
          dedupe_key: 'change:held3:job',
          status: 'held',
          hold_until: '2026-09-16T06:00:00.000Z',
        },
      ],
    });

    const held3 = db.messages.find((m) => m.id === 'held-3')!;
    const realFrom = fakeAdmin.from.bind(fakeAdmin);
    fakeAdmin.from = (table: string) => {
      const q = realFrom(table) as {
        update: (payload: Record<string, unknown>) => {
          eq: (...args: [string, unknown]) => unknown;
          [key: string]: unknown;
        };
        [key: string]: unknown;
      };
      if (table !== 'messages') return q;
      const realUpdate = q.update.bind(q);
      q.update = (payload: Record<string, unknown>) => {
        const chain = realUpdate(payload) as {
          eq: (col: string, val: unknown) => unknown;
          [key: string]: unknown;
        };
        const realEq = chain.eq.bind(chain);
        chain.eq = (col: string, val: unknown) => {
          // Lose the race on held-3: another runner claimed it first.
          if (payload.status === 'queued' && col === 'id' && val === 'held-3') {
            held3.status = 'queued';
          }
          return realEq(col, val);
        };
        return chain;
      };
      return q;
    };

    const { sendHeldMessages } = await loadSend();
    const counts = await sendHeldMessages(
      new Date('2026-09-16T07:00:00.000Z'),
    );
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({
      clientReference: 'held-1',
    });
    expect(db.messages.find((m) => m.id === 'held-1')?.status).toBe('sent');
    expect(db.messages.find((m) => m.id === 'held-3')?.status).toBe('queued');
    expect(counts.sent).toBe(1);
  });

  it('skips a held text when the business has no entitled Rounds plan, and refunds the credits taken when it was held', async () => {
    resetDb({
      messages: [
        {
          id: 'held-lapsed',
          tenant_id: TENANT,
          thread_id: 'thr-held',
          customer_id: CUSTOMER,
          kind: 'visit_change',
          body: 'Held text',
          to_address: '+447700900123',
          segments: 1,
          billed_from: 'allowance',
          billed_month: '2026-09',
          job_id: null,
          job_ids: [],
          dedupe_key: 'change:lapsed:job',
          status: 'held',
          hold_until: '2026-09-16T06:00:00.000Z',
        },
      ],
    });
    listRoundsTenantIds.mockResolvedValue([]);

    const { sendHeldMessages } = await loadSend();
    const counts = await sendHeldMessages(new Date('2026-09-16T07:00:00.000Z'));

    expect(sendText).not.toHaveBeenCalled();
    expect(counts).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
    expect(db.messages.find((m) => m.id === 'held-lapsed')).toMatchObject({
      status: 'skipped',
      error: 'plan_ended',
    });
    expect(db.refundCalls).toEqual([
      { p_segments: 1, p_from: 'allowance', p_month: '2026-09' },
    ]);
    expect(db.claimCalls).toEqual([]);
  });

  it('sends nothing when the Rounds tenant list fails', async () => {
    resetDb({
      messages: [
        {
          id: 'held-lapsed',
          tenant_id: TENANT,
          thread_id: 'thr-held',
          customer_id: CUSTOMER,
          kind: 'visit_change',
          body: 'Held text',
          to_address: '+447700900123',
          segments: 1,
          billed_from: 'allowance',
          billed_month: '2026-09',
          status: 'held',
          hold_until: '2026-09-16T06:00:00.000Z',
        },
      ],
    });
    listRoundsTenantIds.mockRejectedValue(new Error('db down'));

    const { sendHeldMessages } = await loadSend();
    const counts = await sendHeldMessages(new Date('2026-09-16T07:00:00.000Z'));

    expect(sendText).not.toHaveBeenCalled();
    expect(counts).toEqual({ sent: 0, emailed: 0, skipped: 0, failed: 0 });
    expect(db.messages[0]?.status).toBe('held');
  });
});

describe('retryFailedTexts', () => {
  beforeEach(() => {
    vi.resetModules();
    sendText.mockReset();
    sendText.mockResolvedValue({
      ok: true,
      provider: 'log',
      providerMessageId: 'log_abc',
      segments: 1,
    });
    activeProvider.mockReturnValue('log');
    ourNumber.mockReturnValue('+447700900100');
    listRoundsTenantIds.mockReset();
    listRoundsTenantIds.mockResolvedValue([TENANT]);
  });

  function failedRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'failed-1',
      tenant_id: TENANT,
      thread_id: 'thr-f',
      customer_id: CUSTOMER,
      direction: 'outbound',
      channel: 'sms',
      kind: 'reminder',
      body: "Acme: we're due…",
      to_address: '+447700900123',
      segments: 1,
      job_id: 'job-f',
      job_ids: ['job-f'],
      dedupe_key: 'reminder:2026-10-01:job-f',
      status: 'failed',
      provider_status: 'send_failed',
      error: 'PureSMS 503',
      created_at: '2026-09-15T16:00:00.000Z',
      ...overrides,
    };
  }

  function seed(message: ReturnType<typeof failedRow>) {
    resetDb({
      threads: [
        {
          id: 'thr-f',
          tenant_id: TENANT,
          customer_id: CUSTOMER,
          channel: 'sms',
          customer_address: '+447700900123',
        },
      ],
      jobs: [
        { id: 'job-f', tenant_id: TENANT, status: 'assigned', scheduled_date: '2026-10-01' },
      ],
      messages: [message],
    });
  }

  it('resends a failed reminder the next morning', async () => {
    seed(failedRow());
    const { retryFailedTexts } = await loadSend();

    const counts = await retryFailedTexts(new Date('2026-09-16T07:00:00.000Z'));

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({ body: "Acme: we're due…" });
    expect(counts.sent).toBe(1);
    expect(db.messages[0]).toMatchObject({ status: 'sent', provider_status: null });
  });

  it('gives up after the second retry and flags the conversation', async () => {
    seed(failedRow({ provider_status: 'retry_1_failed' }));
    sendText.mockResolvedValueOnce({
      ok: false,
      provider: 'puresms',
      error: 'PureSMS 503',
      retryable: true,
    });
    const { retryFailedTexts } = await loadSend();

    const counts = await retryFailedTexts(new Date('2026-09-17T07:00:00.000Z'));

    expect(counts.gaveUp).toBe(1);
    expect(db.messages[0]).toMatchObject({ status: 'failed', provider_status: 'retry_2_failed' });
    expect(db.threads[0] as Record<string, unknown>).toMatchObject({ status: 'needs_attention' });
  });

  it('does not resend a reminder whose visit moved', async () => {
    seed(failedRow());
    db.jobs[0]!.scheduled_date = '2026-10-05';
    const { retryFailedTexts } = await loadSend();

    const counts = await retryFailedTexts(new Date('2026-09-16T07:00:00.000Z'));

    expect(sendText).not.toHaveBeenCalled();
    expect(counts.skipped).toBe(1);
    expect(db.messages[0]).toMatchObject({ status: 'skipped', error: 'visit_changed' });
  });

  it('leaves an old failed row with no saved text alone', async () => {
    seed(failedRow({ body: '' }));
    const { retryFailedTexts } = await loadSend();

    await retryFailedTexts(new Date('2026-09-16T07:00:00.000Z'));

    expect(sendText).not.toHaveBeenCalled();
    expect(db.messages[0]?.status).toBe('failed');
  });

  it('skips a failed text when the business has no entitled Rounds plan', async () => {
    seed(failedRow());
    listRoundsTenantIds.mockResolvedValue([]);
    const { retryFailedTexts } = await loadSend();

    const counts = await retryFailedTexts(new Date('2026-09-16T07:00:00.000Z'));

    expect(sendText).not.toHaveBeenCalled();
    expect(counts.skipped).toBe(1);
    expect(db.messages[0]).toMatchObject({ status: 'skipped', error: 'plan_ended' });
    expect(db.claimCalls).toEqual([]);
    expect(db.refundCalls).toEqual([]);
  });
});
