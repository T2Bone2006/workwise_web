import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  sendCustomerMessage,
  createAdminClient,
  createInvoiceCore,
  getInvoice,
  resendSend,
  getTenantMessagingContext,
} = vi.hoisted(() => ({
  sendCustomerMessage: vi.fn(),
  createAdminClient: vi.fn(),
  createInvoiceCore: vi.fn(),
  getInvoice: vi.fn(),
  resendSend: vi.fn(),
  getTenantMessagingContext: vi.fn(),
}));

vi.mock('@/lib/messaging/send', () => ({
  sendCustomerMessage: (...args: unknown[]) => sendCustomerMessage(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClient(),
}));

vi.mock('@/lib/invoices/invoice-core', () => ({
  createInvoiceCore: (...args: unknown[]) => createInvoiceCore(...args),
}));

vi.mock('@/lib/data/payments/invoices', () => ({
  getInvoice: (...args: unknown[]) => getInvoice(...args),
}));

vi.mock('@/lib/invoices/render', () => ({
  renderInvoicePdf: async () => Buffer.from('pdf'),
}));

vi.mock('@/lib/invoices/view-model', () => ({
  toInvoiceViewModel: () => ({}),
}));

vi.mock('@/lib/data/payments/owed', () => ({
  getCustomerBalance: async () => ({
    owedAmount: 15,
    unpaidVisitCount: 1,
    oldestUnpaidDate: '2026-09-28',
    creditAmount: 0,
  }),
}));

vi.mock('@/lib/data/payments/settings', () => ({
  getPaymentSettings: async () => ({
    connect: { status: 'inactive' },
    bankAccountName: null,
    bankSortCode: null,
    bankAccountNumber: null,
  }),
  hasBankDetails: () => false,
}));

vi.mock('@/lib/messaging/brand', () => ({
  getTenantMessagingContext: (...args: unknown[]) => getTenantMessagingContext(...args),
}));

vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: (...args: unknown[]) => resendSend(...args) } },
}));

import { sendVisitDoneNotice } from '@/lib/payments/notify';

const TENANT = 'tenant-1';
const JOB = 'job-1';
const CUSTOMER = 'cust-1';

type Note = Record<string, unknown> & { id: string };

let notes: Note[];
let customer: Record<string, unknown>;
let job: Record<string, unknown>;
/** The other services at the same house that day; null = only `job`. */
let stopJobs: Record<string, unknown>[] | null;

function chain(data: unknown) {
  const result = { data, error: null as null };
  const api = {
    select() {
      return api;
    },
    eq() {
      return api;
    },
    in() {
      return api;
    },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    is() {
      return api;
    },
    update() {
      return api;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
    then(
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return api;
}

function fakeAdmin() {
  return {
    from(table: string) {
      if (table !== 'notifications') {
        throw new Error(`unexpected admin table ${table}`);
      }
      return {
        insert(payload: Record<string, unknown>) {
          return {
            select() {
              return {
                single() {
                  const duplicate = notes.some(
                    (n) =>
                      n.type === 'visit_done' &&
                      n.job_id === payload.job_id &&
                      payload.type === 'visit_done',
                  );
                  if (duplicate) {
                    return Promise.resolve({
                      data: null,
                      error: { code: '23505', message: 'duplicate' },
                    });
                  }
                  const id = `note-${notes.length + 1}`;
                  notes.push({ id, ...payload });
                  return Promise.resolve({ data: { id }, error: null });
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(col: string, val: unknown) {
              const row = notes.find((n) => n[col] === val);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

/** maybeSingle() → the visit being done; a list read → every visit at the stop. */
function jobsChain() {
  const api = chain(job);
  return {
    ...api,
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    then(
      resolve: (value: { data: unknown; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve({ data: stopJobs ?? [job], error: null }).then(resolve, reject);
    },
  };
}

function supabaseFrom(table: string) {
  if (table === 'jobs') return jobsChain();
  if (table === 'customers') return chain(customer);
  if (table === 'payment_allocations') return chain([]);
  if (table === 'payments') return chain([]);
  if (table === 'tenants') {
    return chain({
      name: "Dave's Windows",
      settings: { company: { email: 'dave@example.com', logo_url: null } },
    });
  }
  if (table === 'invoices') return chain(null);
  throw new Error(`unexpected table ${table}`);
}

const supabase = { from: supabaseFrom };

function baseCustomer(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Sarah',
    email: 'sarah@example.com',
    phone_e164: '+447700900123',
    preferred_channel: null,
    payment_terms: 'on_the_day',
    bank_reference_hint: null,
    pay_link_token: 'pay-token',
    ...overrides,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
  notes = [];
  stopJobs = null;
  customer = baseCustomer();
  job = {
    id: JOB,
    customer_id: CUSTOMER,
    status: 'completed',
    payment_status: 'unpaid',
    scheduled_date: '2026-09-28',
    completed_at: null,
    address: '12 Elm Rd',
    postcode: 'AB1 2CD',
    job_description: 'Window clean',
    custom_fields: null,
    quoted_amount: 15,
    final_amount: 15,
  };
  sendCustomerMessage.mockReset();
  createAdminClient.mockReset();
  createAdminClient.mockImplementation(() => fakeAdmin());
  createInvoiceCore.mockReset();
  createInvoiceCore.mockResolvedValue({
    success: true,
    invoiceId: 'inv-1',
    number: 'INV-0001',
    existing: false,
  });
  getInvoice.mockReset();
  getInvoice.mockResolvedValue({
    status: 'issued',
    number: 'INV-0001',
    total: 15,
    balanceDue: 15,
    dueDate: '2026-10-12',
    publicToken: 'public-token',
  });
  resendSend.mockReset();
  resendSend.mockResolvedValue({ data: { id: 're_1' }, error: null });
  getTenantMessagingContext.mockReset();
  getTenantMessagingContext.mockResolvedValue({
    contactPhone: '+447700900111',
  });
});

async function done() {
  return sendVisitDoneNotice(supabase as never, {
    tenantId: TENANT,
    jobId: JOB,
  });
}

describe('sendVisitDoneNotice channels', () => {
  it('emails a business-default customer once', async () => {
    sendCustomerMessage.mockImplementation(async (input: {
      email: (() => Promise<unknown>) | null;
    }) => {
      await input.email?.();
      return { outcome: 'email_sent', messageId: 'msg-1' };
    });

    const result = await done();

    expect(result).toMatchObject({ outcome: 'sent', channel: 'email' });
    expect(sendCustomerMessage).toHaveBeenCalledTimes(1);
    expect(sendCustomerMessage.mock.calls[0][0].email).toEqual(expect.any(Function));
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(notes[0]?.channel).toBe('email');
    expect(notes[0]?.status).toBe('sent');
  });

  it('texts a Text-first customer and records channel sms', async () => {
    customer = baseCustomer({ preferred_channel: 'sms' });
    sendCustomerMessage.mockImplementation(async (input: {
      text: (ctx: { firstText: boolean }) => string;
    }) => {
      input.text({ firstText: false });
      return { outcome: 'text_sent', messageId: 'msg-1' };
    });

    const result = await done();

    expect(result).toMatchObject({ outcome: 'sent', channel: 'sms' });
    expect(resendSend).not.toHaveBeenCalled();
    expect(notes[0]?.channel).toBe('sms');
    expect(notes[0]?.provider).toBe('puresms');
  });

  it('forces the PDF email for an invoice customer even when Text first', async () => {
    customer = baseCustomer({
      preferred_channel: 'sms',
      payment_terms: 'invoice',
    });
    sendCustomerMessage.mockImplementation(async (input: {
      email: () => Promise<unknown>;
    }) => {
      await input.email();
      return { outcome: 'email_sent', messageId: 'msg-1' };
    });

    const result = await done();

    expect(result).toMatchObject({ outcome: 'sent', channel: 'email' });
    expect(sendCustomerMessage.mock.calls[0][0].channelOrderOverride).toEqual([
      'email',
      'text',
    ]);
    expect(resendSend).toHaveBeenCalledTimes(1);
    const payload = resendSend.mock.calls[0][0] as { attachments?: unknown[] };
    expect(payload.attachments).toHaveLength(1);
  });

  it('texts an invoice link when the invoice customer has no email', async () => {
    customer = baseCustomer({
      email: null,
      phone_e164: '+447700900123',
      payment_terms: 'invoice',
    });
    let sms = '';
    sendCustomerMessage.mockImplementation(async (input: {
      email: unknown;
      text: (ctx: { firstText: boolean }) => string;
    }) => {
      expect(input.email).toBeNull();
      sms = input.text({ firstText: true });
      return { outcome: 'text_sent', messageId: 'msg-1' };
    });

    const result = await done();

    expect(result).toMatchObject({ outcome: 'sent', channel: 'sms' });
    expect(sms).toContain('Invoice INV-0001');
    expect(sms).toContain('https://app.example/pay/i/public-token');
    expect(resendSend).not.toHaveBeenCalled();
  });

  it('skips a landline with no email and does not claim', async () => {
    customer = baseCustomer({
      email: null,
      phone_e164: '+441132960001',
    });

    const result = await done();

    expect(result).toEqual({ outcome: 'skipped_no_channel', invoiceId: undefined });
    expect(notes).toEqual([]);
    expect(sendCustomerMessage).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('does not send again when Done is replayed', async () => {
    sendCustomerMessage.mockImplementation(async (input: {
      email: () => Promise<unknown>;
    }) => {
      await input.email();
      return { outcome: 'email_sent', messageId: 'msg-1' };
    });

    const first = await done();
    const second = await done();

    expect(first).toMatchObject({ outcome: 'sent', channel: 'email' });
    expect(second).toMatchObject({ outcome: 'already_sent' });
    expect(sendCustomerMessage).toHaveBeenCalledTimes(1);
    expect(resendSend).toHaveBeenCalledTimes(1);
  });
});

describe('sendVisitDoneNotice one message per stop', () => {
  const gutters = () => ({
    ...job,
    id: 'job-2',
    job_description: 'Gutters',
    quoted_amount: 20,
    final_amount: 20,
  });

  function textSend() {
    sendCustomerMessage.mockImplementation(async (input: {
      text: (ctx: { firstText: boolean }) => string;
    }) => {
      input.text({ firstText: false });
      return { outcome: 'text_sent', messageId: 'msg-1' };
    });
  }

  it('waits while another service at the house is still to do', async () => {
    stopJobs = [job, { ...gutters(), status: 'assigned' }];
    textSend();

    const result = await done();

    expect(result).toEqual({ outcome: 'waiting_for_stop' });
    expect(sendCustomerMessage).not.toHaveBeenCalled();
    expect(notes).toEqual([]);
  });

  it('sends one message for every service once the stop is done', async () => {
    customer = baseCustomer({ preferred_channel: 'sms' });
    stopJobs = [gutters(), job];
    textSend();

    const result = await done();

    expect(result).toMatchObject({ outcome: 'sent', channel: 'sms' });
    expect(sendCustomerMessage).toHaveBeenCalledTimes(1);
    const input = sendCustomerMessage.mock.calls[0][0] as {
      jobIds: string[];
      dedupeKey: string;
      text: (ctx: { firstText: boolean }) => string;
    };
    expect(input.jobIds).toEqual(['job-1', 'job-2']);
    expect(input.dedupeKey).toBe('visit_done:job-1');
    const text = input.text({ firstText: false });
    expect(text).toContain('window clean and gutters');
    expect(text).toContain('£35 to pay');
    expect(notes.map((n) => n.job_id).sort()).toEqual(['job-1', 'job-2']);
    expect(createInvoiceCore).not.toHaveBeenCalled();
  });

  it('does not message the stop twice when the other Done replays', async () => {
    stopJobs = [job, gutters()];
    textSend();
    await done();
    sendCustomerMessage.mockClear();

    const again = await done();

    expect(again.outcome).toBe('already_sent');
    expect(sendCustomerMessage).not.toHaveBeenCalled();
  });

  it('makes one invoice for the whole stop', async () => {
    customer = baseCustomer({ payment_terms: 'invoice' });
    stopJobs = [job, gutters()];
    sendCustomerMessage.mockResolvedValue({ outcome: 'email_sent', messageId: 'msg-1' });

    await done();

    expect(createInvoiceCore).toHaveBeenCalledTimes(1);
    expect(createInvoiceCore.mock.calls[0][1]).toMatchObject({
      scope: 'visit',
      jobIds: ['job-1', 'job-2'],
    });
  });

  it('force sends for what is done when a service was left for another day', async () => {
    stopJobs = [job, { ...gutters(), status: 'assigned' }];
    textSend();

    const result = await sendVisitDoneNotice(supabase as never, {
      tenantId: TENANT,
      jobId: JOB,
      force: true,
    });

    expect(result.outcome).toBe('sent');
    expect((sendCustomerMessage.mock.calls[0][0] as { jobIds: string[] }).jobIds).toEqual([
      'job-1',
    ]);
  });
});
