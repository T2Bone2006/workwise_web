import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAllowance } from '@/lib/billing/pro-allowance';

const loadWorkerAllowance = vi.fn();
const recordExtraWorkerConsent = vi.fn();
const reconcileExtraWorkersAfterChange = vi.fn();
const sendEmail = vi.fn();
const generateLink = vi.fn();
const deleteUser = vi.fn();
const postcodeToLatLng = vi.fn();
const previewExtraWorkerCharge = vi.fn();

let workerInsert: { data: { id: string } | null; error: { message: string } | null };
let existingWorker: { id: string } | null;
let inviteTokenInsert: { error: { message: string } | null };
let inserted: Array<{ table: string; row: Record<string, unknown> }>;

vi.mock('server-only', () => ({}));
vi.mock('@/lib/resend', () => ({ resend: { emails: { send: (...a: unknown[]) => sendEmail(...a) } }, FROM_EMAIL: 'noreply@test' }));
vi.mock('@/lib/utils/postcode', () => ({ postcodeToLatLng: (...a: unknown[]) => postcodeToLatLng(...a) }));
vi.mock('@/lib/data/worker-allowance', () => ({
  loadWorkerAllowance: (...a: unknown[]) => loadWorkerAllowance(...a),
  recordExtraWorkerConsent: (...a: unknown[]) => recordExtraWorkerConsent(...a),
}));
vi.mock('@/lib/billing/extra-workers-preview', () => ({
  previewExtraWorkerCharge: (...a: unknown[]) => previewExtraWorkerCharge(...a),
}));
vi.mock('@/lib/billing/extra-workers', () => ({
  reconcileExtraWorkersAfterChange: (...a: unknown[]) => reconcileExtraWorkersAfterChange(...a),
}));

function userScopedClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user_1' } } }) },
    from(table: string) {
      const api = {
        select: () => api,
        eq: () => api,
        single: async () => {
          if (table === 'users') return { data: { tenant_id: 'tenant_1' } };
          if (table === 'tenants') return { data: { name: 'Clearview' } };
          return { data: workerInsert.data, error: workerInsert.error };
        },
        maybeSingle: async () => ({ data: existingWorker }),
        insert(row: Record<string, unknown>) {
          inserted.push({ table, row });
          if (table === 'workers') return { select: () => ({ single: async () => workerInsert }) };
          return Promise.resolve({ error: null });
        },
      };
      return api;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => userScopedClient() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { generateLink: (...a: unknown[]) => generateLink(...a), deleteUser: (...a: unknown[]) => deleteUser(...a) } },
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserted.push({ table, row });
          return Promise.resolve(table === 'worker_invites' ? inviteTokenInsert : { error: null });
        },
      };
    },
  }),
}));

const over = computeAllowance({ tier: 'starter', source: 'stripe', includedOverride: null, used: 10 });
const within = computeAllowance({ tier: 'starter', source: 'stripe', includedOverride: null, used: 3 });

function inviteForm(extra: Record<string, string> = {}) {
  const f = new FormData();
  f.set('full_name', 'Dave Mercer');
  f.set('phone', '07700900123');
  f.set('email', 'dave@example.com');
  f.set('home_postcode', 'M3 2ER');
  f.set('worker_type', 'company_subcontractor');
  f.set('status', 'available');
  f.set('skills', '[]');
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

beforeEach(() => {
  for (const m of [loadWorkerAllowance, recordExtraWorkerConsent, reconcileExtraWorkersAfterChange, sendEmail, generateLink, deleteUser, postcodeToLatLng, previewExtraWorkerCharge]) m.mockReset();
  workerInsert = { data: { id: 'worker_1' }, error: null };
  existingWorker = null;
  inviteTokenInsert = { error: null };
  inserted = [];
  postcodeToLatLng.mockResolvedValue({ lat: 53.4, lng: -2.2 });
  generateLink.mockResolvedValue({ data: { user: { id: 'auth_1' } }, error: null });
  deleteUser.mockResolvedValue({ error: null });
  sendEmail.mockResolvedValue({ error: null });
  loadWorkerAllowance.mockResolvedValue(within);
  previewExtraWorkerCharge.mockResolvedValue({ ok: false });
});

async function core() {
  return import('@/lib/workers/worker-create-core');
}

describe('inviteWorkerCore', () => {
  it('today\'s behaviour: creates the worker, the invite, sends the email, reconciles once', async () => {
    const { inviteWorkerCore } = await core();
    const result = await inviteWorkerCore(inviteForm());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.workerId).toBe('worker_1');
      expect(result.inviteToken).toEqual(expect.any(String));
    }
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(reconcileExtraWorkersAfterChange).toHaveBeenCalledWith('tenant_1');
    expect(recordExtraWorkerConsent).not.toHaveBeenCalled(); // within the allowance: no agreement needed
    expect(inserted.some((i) => i.table === 'worker_invites')).toBe(true);
  });

  it('asks for agreement before the worker that goes over, and creates nothing', async () => {
    loadWorkerAllowance.mockResolvedValue(over);
    const { inviteWorkerCore } = await core();
    const result = await inviteWorkerCore(inviteForm());
    expect(result).toMatchObject({ success: false, needsExtraWorkerConfirm: { workerNumber: 11 } });
    expect(generateLink).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('records the agreement when it was given', async () => {
    loadWorkerAllowance.mockResolvedValue(over);
    const { inviteWorkerCore } = await core();
    const result = await inviteWorkerCore(inviteForm({ confirm_extra_worker: 'true' }));
    expect(result.success).toBe(true);
    expect(recordExtraWorkerConsent).toHaveBeenCalledTimes(1);
    expect(recordExtraWorkerConsent.mock.calls[0][0]).toMatchObject({ tenantId: 'tenant_1', userId: 'user_1', workerId: 'worker_1' });
  });

  it('bulk options: no allowance check, no consent, no reconcile, no email, but the token is returned', async () => {
    loadWorkerAllowance.mockResolvedValue(over);
    const { inviteWorkerCore } = await core();
    const result = await inviteWorkerCore(inviteForm(), { allowance: 'skip', reconcile: 'skip', recordConsent: false, sendEmail: false });
    expect(result).toMatchObject({ success: true, workerId: 'worker_1', inviteToken: expect.any(String) });
    expect(loadWorkerAllowance).not.toHaveBeenCalled();
    expect(recordExtraWorkerConsent).not.toHaveBeenCalled();
    expect(reconcileExtraWorkersAfterChange).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('bulk: a failed token insert returns success with no token, so the finish step reports it', async () => {
    inviteTokenInsert = { error: { message: 'boom' } };
    const { inviteWorkerCore } = await core();
    const result = await inviteWorkerCore(inviteForm(), { sendEmail: false, reconcile: 'skip' });
    expect(result).toMatchObject({ success: true, inviteToken: null });
  });

  it('rolls back the login it made when the worker row cannot be saved', async () => {
    workerInsert = { data: null, error: { message: 'insert failed' } };
    const { inviteWorkerCore } = await core();
    const result = await inviteWorkerCore(inviteForm());
    expect(result).toEqual({ success: false, error: 'insert failed' });
    expect(deleteUser).toHaveBeenCalledWith('auth_1');
    expect(reconcileExtraWorkersAfterChange).not.toHaveBeenCalled();
  });

  it('refuses an email that is already on this team', async () => {
    existingWorker = { id: 'w_old' };
    const { inviteWorkerCore } = await core();
    const result = await inviteWorkerCore(inviteForm());
    expect(result).toEqual({ success: false, error: 'A worker with this email already exists for your company.' });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it('reports an email failure but keeps the worker (the Invited tab can resend)', async () => {
    sendEmail.mockResolvedValue({ error: { message: 'resend down' } });
    const { inviteWorkerCore } = await core();
    const result = await inviteWorkerCore(inviteForm());
    expect(result).toEqual({ success: false, error: 'Failed to send invitation email. Please try again.' });
  });
});

describe('createWorkerCore', () => {
  function plainForm(extra: Record<string, string> = {}) {
    const f = inviteForm(extra);
    f.set('email', '');
    return f;
  }

  it("today's behaviour: creates the worker and reconciles", async () => {
    const { createWorkerCore } = await core();
    const result = await createWorkerCore(plainForm());
    expect(result).toEqual({ success: true, workerId: 'worker_1' });
    expect(reconcileExtraWorkersAfterChange).toHaveBeenCalledWith('tenant_1');
  });

  it('asks for agreement past the allowance', async () => {
    loadWorkerAllowance.mockResolvedValue(over);
    const { createWorkerCore } = await core();
    const result = await createWorkerCore(plainForm());
    expect(result).toMatchObject({ success: false, needsExtraWorkerConfirm: { workerNumber: 11 } });
    expect(inserted).toEqual([]);
  });

  it('bulk options skip the allowance, the consent and the reconcile', async () => {
    loadWorkerAllowance.mockResolvedValue(over);
    const { createWorkerCore } = await core();
    const result = await createWorkerCore(plainForm(), { allowance: 'skip', reconcile: 'skip', recordConsent: false });
    expect(result).toEqual({ success: true, workerId: 'worker_1' });
    expect(loadWorkerAllowance).not.toHaveBeenCalled();
    expect(recordExtraWorkerConsent).not.toHaveBeenCalled();
    expect(reconcileExtraWorkersAfterChange).not.toHaveBeenCalled();
  });
});

describe('the notice shown for an extra worker', () => {
  function plainForm() {
    const f = inviteForm();
    f.set('email', '');
    return f;
  }

  it('uses Stripe\'s interval and the exact charge-now figure when it is available', async () => {
    loadWorkerAllowance.mockResolvedValue(over);
    previewExtraWorkerCharge.mockResolvedValue({ ok: true, interval: 'year', extrasAfter: 1, perWorkerPence: 12000, chargeNowPence: 5836, renewalExtrasPence: 12000 });
    const { createWorkerCore } = await core();
    const result = await createWorkerCore(plainForm());
    expect(result).toMatchObject({
      success: false,
      needsExtraWorkerConfirm: { interval: 'year', perWorkerPence: 12000, chargeNowPence: 5836, workerNumber: 11 },
    });
    if (!result.success) expect(result.error).toContain('£120 a year');
  });

  it('still asks (monthly wording) when Stripe cannot be asked', async () => {
    loadWorkerAllowance.mockResolvedValue(over);
    previewExtraWorkerCharge.mockRejectedValue(new Error('stripe down'));
    const { createWorkerCore } = await core();
    const result = await createWorkerCore(plainForm());
    expect(result).toMatchObject({ success: false, needsExtraWorkerConfirm: { interval: 'month', perWorkerPence: 1200 } });
  });

  it('records the price the owner was shown as their agreement', async () => {
    loadWorkerAllowance.mockResolvedValue(over);
    previewExtraWorkerCharge.mockResolvedValue({ ok: true, interval: 'year', extrasAfter: 1, perWorkerPence: 12000, chargeNowPence: 5836, renewalExtrasPence: 12000 });
    const { createWorkerCore } = await core();
    const form = plainForm();
    form.set('confirm_extra_worker', 'true');
    await createWorkerCore(form);
    expect(recordExtraWorkerConsent.mock.calls[0][0].notice).toMatchObject({ interval: 'year', perWorkerPence: 12000 });
  });
});

