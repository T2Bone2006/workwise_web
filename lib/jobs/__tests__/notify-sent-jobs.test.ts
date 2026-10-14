import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SentJob } from '@/lib/jobs/worker-job-alert';

const sendEmail = vi.fn<(payload: { to: string; subject: string }) => Promise<{ error: null }>>();
const sendText = vi.fn<
  (payload: { to: string; body: string; sender?: string }) => Promise<{
    ok: boolean;
    provider: string;
    providerMessageId: string;
    segments: number;
    error: string;
    retryable: boolean;
  }>
>();
const push = vi.fn<
  (payload: { token: string | null; jobs: { jobId: string; referenceNumber: string }[] }) => Promise<void>
>();
const rpc = vi.fn<
  (name: string, args: unknown) => Promise<{ data: string | null; error: { message: string } | null }>
>();

vi.mock('@/lib/resend', () => ({
  FROM_EMAIL: 'noreply@test',
  resend: { emails: { send: (payload: { to: string; subject: string }) => sendEmail(payload) } },
}));
vi.mock('@/lib/messaging/provider', () => ({
  sendText: (payload: { to: string; body: string; sender?: string }) => sendText(payload),
}));
vi.mock('@/lib/services/worker-push', () => ({
  sendJobsAssignedPushToWorker: (payload: {
    token: string | null;
    jobs: { jobId: string; referenceNumber: string }[];
  }) => push(payload),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    throw new Error('pass db');
  },
}));

import { notifyWorkersOfSentJobs } from '@/lib/jobs/notify-sent-jobs';

type Row = Record<string, unknown>;

function query(rows: Row[], error: { message: string } | null = null) {
  const filters: { col: string; kind: 'eq' | 'in'; value: unknown }[] = [];
  const api = {
    select: () => api,
    eq(col: string, value: unknown) {
      filters.push({ col, kind: 'eq', value });
      return api;
    },
    in(col: string, value: unknown) {
      filters.push({ col, kind: 'in', value });
      return api;
    },
    maybeSingle: () => Promise.resolve(finish(true)),
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(finish(false)).then(resolve);
    },
  };
  function finish(single: boolean) {
    if (error) return { data: null, error };
    const matched = rows.filter((row) =>
      filters.every((filter) =>
        filter.kind === 'eq' ? row[filter.col] === filter.value : (filter.value as unknown[]).includes(row[filter.col]),
      ),
    );
    return { data: single ? (matched[0] ?? null) : matched, error: null };
  }
  return api;
}

function dbFor(over: { workers?: Row[]; workerError?: { message: string } | null; claim?: string | null; claimError?: boolean } = {}) {
  const workers = over.workers ?? [
    {
      id: 'dave',
      email: 'dave@example.com',
      phone: '07700900123',
      expo_push_token: 'ExponentPushToken[dave]',
      notify_job_email: true,
      notify_job_sms: false,
    },
  ];
  let workerReads = 0;
  return {
    from(table: string) {
      if (table === 'tenants') {
        return query([{ id: 't1', name: 'RS Locksmiths', settings: {} }]);
      }
      if (table === 'workers') {
        workerReads += 1;
        const missingColumns = workerReads === 1 ? over.workerError ?? null : null;
        return query(workers, missingColumns);
      }
      if (table === 'subscriptions') return query([{ tenant_id: 't1', product: 'starter', status: 'active' }]);
      throw new Error(table);
    },
    rpc(name: string, args: unknown) {
      if (over.claimError && name === 'claim_worker_job_text') {
        return Promise.resolve({ data: null, error: { message: 'down' } });
      }
      if (name === 'claim_worker_job_text') {
        return Promise.resolve({ data: over.claim ?? 'allowance', error: null });
      }
      return rpc(name, args);
    },
  };
}

function sent(over: Partial<SentJob> = {}): SentJob {
  return {
    id: 'j1',
    workerId: 'dave',
    referenceNumber: 'WW-1',
    postcode: 'SW1A 1AA',
    scheduledDate: '2026-10-15',
    scheduledTime: '09:00:00',
    customerName: 'Jane Smith',
    ...over,
  };
}

describe('notifyWorkersOfSentJobs', () => {
  beforeEach(() => {
    sendEmail.mockReset();
    sendText.mockReset();
    push.mockReset();
    rpc.mockReset();
    sendEmail.mockResolvedValue({ error: null });
    sendText.mockResolvedValue({
      ok: true,
      provider: 'log',
      providerMessageId: 'm1',
      segments: 1,
      error: '',
      retryable: false,
    });
    push.mockResolvedValue(undefined);
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it('sends one email and one push for five jobs, and no text until they turn it on', async () => {
    const jobs = [1, 2, 3, 4, 5].map((n) => sent({ id: `j${n}`, referenceNumber: `WW-${n}` }));
    await notifyWorkersOfSentJobs({ tenantId: 't1', jobs, db: dbFor() as never });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0]?.[0]).toMatchObject({
      to: 'dave@example.com',
      subject: '5 new jobs from RS Locksmiths',
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]?.[0]).toMatchObject({
      token: 'ExponentPushToken[dave]',
      jobs: jobs.map((job) => ({ jobId: job.id, referenceNumber: job.referenceNumber })),
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it('texts from WorkWise when they opted in, and skips the email they turned off', async () => {
    await notifyWorkersOfSentJobs({
      tenantId: 't1',
      jobs: [sent()],
      db: dbFor({
        workers: [
          {
            id: 'dave',
            email: 'dave@example.com',
            phone: '07700900123',
            expo_push_token: null,
            notify_job_email: false,
            notify_job_sms: true,
          },
        ],
      }) as never,
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[0]).toMatchObject({
      to: '+447700900123',
      body: 'RS Locksmiths: 1 new job. Open the app.',
      sender: 'WorkWise',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('emails instead when the text allowance is used up', async () => {
    await notifyWorkersOfSentJobs({
      tenantId: 't1',
      jobs: [sent()],
      db: dbFor({
        claim: 'none',
        workers: [
          {
            id: 'dave',
            email: 'dave@example.com',
            phone: '07700900123',
            expo_push_token: null,
            notify_job_email: false,
            notify_job_sms: true,
          },
        ],
      }) as never,
    });

    expect(sendText).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not text when the claim errors, and refunds when the send fails', async () => {
    await notifyWorkersOfSentJobs({
      tenantId: 't1',
      jobs: [sent()],
      db: dbFor({
        claimError: true,
        workers: [
          {
            id: 'dave',
            email: null,
            phone: '07700900123',
            expo_push_token: null,
            notify_job_email: true,
            notify_job_sms: true,
          },
        ],
      }) as never,
    });
    expect(sendText).not.toHaveBeenCalled();

    sendText.mockResolvedValueOnce({
      ok: false,
      provider: 'puresms',
      providerMessageId: '',
      segments: 1,
      error: 'no',
      retryable: false,
    });
    await notifyWorkersOfSentJobs({
      tenantId: 't1',
      jobs: [sent()],
      db: dbFor({
        workers: [
          {
            id: 'dave',
            email: null,
            phone: '07700900123',
            expo_push_token: null,
            notify_job_email: false,
            notify_job_sms: true,
          },
        ],
      }) as never,
    });
    expect(rpc).toHaveBeenCalledWith('refund_worker_job_text', { p_tenant_id: 't1', p_segments: 1 });
  });

  it('still emails with the switches at their defaults when the columns are not there yet', async () => {
    await notifyWorkersOfSentJobs({
      tenantId: 't1',
      jobs: [sent(), sent({ id: 'j2', workerId: 'pete' })],
      db: dbFor({
        workerError: { message: 'column workers.notify_job_email does not exist' },
        workers: [
          { id: 'dave', email: 'dave@example.com', phone: '07700900123', expo_push_token: 'tok' },
          { id: 'pete', email: 'pete@example.com', phone: '02079460000', expo_push_token: null },
        ],
      }) as never,
    });

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendText).not.toHaveBeenCalled();
  });
});
