import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAllowance } from '@/lib/billing/pro-allowance';

const getTenantProducts = vi.fn();
const countTeamWorkers = vi.fn();
const loadProSubscription = vi.fn();
const recordExtraWorkerConsent = vi.fn();
const previewExtraWorkerCharge = vi.fn();
const reconcileExtraWorkersAfterChange = vi.fn();
const lookupPostcodes = vi.fn();
const inviteWorkerCore = vi.fn();
const createWorkerCore = vi.fn();
const batchSend = vi.fn();

let paidFor: number | null = null;
let role: string | null;
let takenEmails: string[];
let workersForFinish: Array<Record<string, unknown>>;
let invitesForFinish: Array<Record<string, unknown>>;

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/resend', () => ({ resend: { batch: { send: (...a: unknown[]) => batchSend(...a) } }, FROM_EMAIL: 'noreply@test' }));
vi.mock('@/lib/data/tenant-products', () => ({ getTenantProducts: (...a: unknown[]) => getTenantProducts(...a) }));
vi.mock('@/lib/data/workers', () => ({ countTeamWorkers: (...a: unknown[]) => countTeamWorkers(...a) }));
vi.mock('@/lib/data/worker-allowance', async () => {
  const pro = await vi.importActual<typeof import('@/lib/billing/pro-allowance')>('@/lib/billing/pro-allowance');
  const allowanceFor = (
    row: { product: string; source: string; included_workers_override?: number | null },
    used: number,
    paid: number | null = null,
  ) =>
    pro.computeAllowance({
      tier: row.product as 'starter' | 'growth' | 'pro',
      source: row.source === 'manual' ? 'manual' : 'stripe',
      includedOverride: row.included_workers_override ?? null,
      used,
      paidFor: paid,
    });
  return {
    loadProSubscription: (...a: unknown[]) => loadProSubscription(...a),
    recordExtraWorkerConsent: (...a: unknown[]) => recordExtraWorkerConsent(...a),
    allowanceFor,
    allowanceWithPaidFor: async (_tenantId: string, row: Parameters<typeof allowanceFor>[0], used: number) =>
      allowanceFor(row, used, paidFor),
  };
});
vi.mock('@/lib/billing/extra-workers-preview', () => ({ previewExtraWorkerCharge: (...a: unknown[]) => previewExtraWorkerCharge(...a) }));
vi.mock('@/lib/billing/extra-workers', () => ({ reconcileExtraWorkersAfterChange: (...a: unknown[]) => reconcileExtraWorkersAfterChange(...a) }));
vi.mock('@/lib/utils/postcode-bulk', () => ({ lookupPostcodes: (...a: unknown[]) => lookupPostcodes(...a) }));
vi.mock('@/lib/utils/postcode', async () => {
  const actual = await vi.importActual<typeof import('@/lib/utils/postcode')>('@/lib/utils/postcode');
  return { ...actual, postcodeToLatLng: async () => ({ lat: 1, lng: 1 }) };
});
vi.mock('@/lib/workers/worker-create-core', () => ({
  inviteWorkerCore: (...a: unknown[]) => inviteWorkerCore(...a),
  createWorkerCore: (...a: unknown[]) => createWorkerCore(...a),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user_1' } } }) },
    from(table: string) {
      const api = {
        select: () => api,
        eq: () => api,
        in: async () => ({ data: takenEmails.map((email) => ({ email })), error: null }),
        maybeSingle: async () => (table === 'users' ? { data: role ? { role, tenant_id: 'tenant_1' } : null } : { data: null }),
      };
      return api;
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const api = {
        select: () => api,
        eq: () => api,
        is: () => api,
        in: async (_column: string, ids: string[]) => ({
          data:
            table === 'workers'
              ? workersForFinish.filter((w) => ids.includes(String(w.id)))
              : invitesForFinish.filter((i) => ids.includes(String(i.worker_id))),
          error: null,
        }),
        maybeSingle: async () => ({ data: { name: 'Clearview' } }),
      };
      return api;
    },
  }),
}));

const starterRow = { product: 'starter', source: 'stripe', status: 'active', stripe_subscription_id: 'sub_1', included_workers_override: null };
const manualRow = { product: 'pro', source: 'manual', status: 'manual', stripe_subscription_id: null, included_workers_override: null };

function rows(n: number, from = 1) {
  return Array.from({ length: n }, (_, i) => ({
    line: from + i,
    name: `Worker ${from + i}`,
    phone: `07700${String(900000 + from + i)}`,
    postcode: 'M3 2ER',
    email: `worker${from + i}@example.com`,
  }));
}

beforeEach(() => {
  for (const m of [getTenantProducts, countTeamWorkers, loadProSubscription, recordExtraWorkerConsent, previewExtraWorkerCharge, reconcileExtraWorkersAfterChange, lookupPostcodes, inviteWorkerCore, createWorkerCore, batchSend]) m.mockReset();
  role = 'admin';
  paidFor = null;
  takenEmails = [];
  workersForFinish = [];
  invitesForFinish = [];
  getTenantProducts.mockResolvedValue({ isPro: true });
  loadProSubscription.mockResolvedValue(starterRow);
  countTeamWorkers.mockResolvedValue(8);
  previewExtraWorkerCharge.mockResolvedValue({ ok: false });
  lookupPostcodes.mockImplementation(async (list: string[]) => new Map(list.map((p) => [p, { lat: 1, lng: 1 }])));
  createWorkerCore.mockImplementation(async (form: FormData) => ({ success: true, workerId: `w_${form.get('full_name')}` }));
  inviteWorkerCore.mockImplementation(async (form: FormData) => ({ success: true, workerId: `w_${form.get('full_name')}`, inviteToken: 'tok' }));
  batchSend.mockResolvedValue({ data: { data: [] }, error: null });
});

const ACTIONS = () => import('@/lib/actions/workers-bulk');

describe('checkBulkWorkers', () => {
  it('works out the one confirmation for the whole batch: Starter, team 8, adding 40', async () => {
    const { checkBulkWorkers } = await ACTIONS();
    const result = await checkBulkWorkers({ rows: rows(40), workerType: 'company_subcontractor' });
    expect(result).toMatchObject({ ok: true, validCount: 40, notice: { teamBefore: 8, adding: 40, teamAfter: 48, newExtras: 38 } });
  });

  it('asks for no confirmation when every extra was already paid for at sign-up', async () => {
    paidFor = 48; // signed up saying 48 workers: the 38 extras are on the bill already
    const { checkBulkWorkers } = await ACTIONS();
    const result = await checkBulkWorkers({ rows: rows(40), workerType: 'company_subcontractor' });
    expect(result).toMatchObject({ ok: true, validCount: 40, notice: null });
  });

  it('asks only about the extras beyond what was paid for', async () => {
    paidFor = 40; // 30 extras paid, adding 40 to a team of 8 makes 38
    const { checkBulkWorkers } = await ACTIONS();
    const result = await checkBulkWorkers({ rows: rows(40), workerType: 'company_subcontractor' });
    expect(result).toMatchObject({ ok: true, notice: { extrasBefore: 30, extrasAfter: 38, newExtras: 8 } });
  });

  it('asks for no confirmation when the batch fits', async () => {
    const { checkBulkWorkers } = await ACTIONS();
    const result = await checkBulkWorkers({ rows: rows(2), workerType: 'employee' });
    expect(result).toMatchObject({ ok: true, notice: null });
  });

  it('marks bad rows and rows already on the team, and counts only the good ones', async () => {
    takenEmails = ['taken@example.com'];
    const { checkBulkWorkers } = await ACTIONS();
    const input = [
      ...rows(2),
      { line: 3, name: 'Taken Person', phone: '07700900300', postcode: 'M3 2ER', email: 'taken@example.com' },
      { line: 4, name: '', phone: '123', postcode: 'x', email: '' },
    ];
    const result = await checkBulkWorkers({ rows: input, workerType: 'company_subcontractor' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validCount).toBe(2);
      expect(result.rows[2].errors).toEqual(['Already on your team']);
      expect(result.rows[3].errors.length).toBeGreaterThan(1);
    }
  });

  it('marks a postcode postcodes.io does not know', async () => {
    lookupPostcodes.mockImplementation(async (list: string[]) => new Map(list.map((p) => [p, null])));
    const { checkBulkWorkers } = await ACTIONS();
    const result = await checkBulkWorkers({ rows: rows(1), workerType: 'employee' });
    expect(result).toMatchObject({ ok: true, validCount: 0 });
    if (result.ok) expect(result.rows[0].errors).toEqual(["We couldn't find that postcode"]);
  });

  it('adds the yearly pro-rata amount from Stripe when there is a notice', async () => {
    previewExtraWorkerCharge.mockResolvedValue({ ok: true, interval: 'year', chargeNowPence: 123400 });
    const { checkBulkWorkers } = await ACTIONS();
    const result = await checkBulkWorkers({ rows: rows(20), workerType: 'employee' });
    expect(result).toMatchObject({ ok: true, interval: 'year', chargeNowPence: 123400 });
  });

  it('gives a manual account no confirmation, whatever the size', async () => {
    loadProSubscription.mockResolvedValue(manualRow);
    countTeamWorkers.mockResolvedValue(500);
    const { checkBulkWorkers } = await ACTIONS();
    expect(await checkBulkWorkers({ rows: rows(40), workerType: 'employee' })).toMatchObject({ ok: true, notice: null });
  });

  it('refuses anyone who is not the account owner, and a business with no Pro tier', async () => {
    const { checkBulkWorkers } = await ACTIONS();
    role = 'worker';
    expect(await checkBulkWorkers({ rows: rows(1), workerType: 'employee' })).toEqual({ ok: false, error: 'Only the account owner can add workers.' });
    role = 'admin';
    getTenantProducts.mockResolvedValue({ isPro: false });
    expect(await checkBulkWorkers({ rows: rows(1), workerType: 'employee' })).toEqual({ ok: false, error: 'Only the account owner can add workers.' });
  });

  it('refuses more than 100 rows and fails safe when the plan cannot be read', async () => {
    const { checkBulkWorkers } = await ACTIONS();
    expect(await checkBulkWorkers({ rows: rows(101), workerType: 'employee' })).toMatchObject({ ok: false });
    loadProSubscription.mockResolvedValue(null);
    expect(await checkBulkWorkers({ rows: rows(1), workerType: 'employee' })).toEqual({ ok: false, error: "We couldn't check your plan. Please try again." });
  });
});

describe('addBulkWorkersChunk', () => {
  it('invites the rows without checking the allowance, sending email, or touching Stripe', async () => {
    const { addBulkWorkersChunk } = await ACTIONS();
    const result = await addBulkWorkersChunk({ rows: rows(3), workerType: 'company_subcontractor', confirmedTeamSize: 48 });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.results.map((r) => r.outcome)).toEqual(['invited', 'invited', 'invited']);
    expect(createWorkerCore).not.toHaveBeenCalled();
    expect(inviteWorkerCore).toHaveBeenCalledTimes(3);
    const opts = inviteWorkerCore.mock.calls[0][1];
    expect(opts).toEqual({ allowance: 'skip', reconcile: 'skip', recordConsent: false, sendEmail: false });
    expect(reconcileExtraWorkersAfterChange).not.toHaveBeenCalled();
    expect(recordExtraWorkerConsent).not.toHaveBeenCalled();
  });

  it('never adds a worker who has no email, because they could not log in', async () => {
    const { addBulkWorkersChunk } = await ACTIONS();
    const noEmail = [{ line: 1, name: 'No Email', phone: '07700900333', postcode: 'M3 2ER', email: '' }];
    const result = await addBulkWorkersChunk({ rows: noEmail, workerType: 'employee', confirmedTeamSize: 48 });
    if (result.ok) expect(result.results[0]).toMatchObject({ outcome: 'failed', error: 'Needs an email so they can log in' });
    expect(createWorkerCore).not.toHaveBeenCalled();
    expect(inviteWorkerCore).not.toHaveBeenCalled();
  });

  it('refuses the whole chunk if the team grew past the size the owner confirmed', async () => {
    countTeamWorkers.mockResolvedValue(46);
    const { addBulkWorkersChunk } = await ACTIONS();
    const result = await addBulkWorkersChunk({ rows: rows(5), workerType: 'employee', confirmedTeamSize: 48 });
    expect(result).toMatchObject({ ok: false, code: 'team_changed' });
    expect(createWorkerCore).not.toHaveBeenCalled();
  });

  it('applies no ceiling to a manual account', async () => {
    loadProSubscription.mockResolvedValue(manualRow);
    countTeamWorkers.mockResolvedValue(500);
    const { addBulkWorkersChunk } = await ACTIONS();
    expect(await addBulkWorkersChunk({ rows: rows(3), workerType: 'employee', confirmedTeamSize: 1 })).toMatchObject({ ok: true });
  });

  it('keeps going when one row fails', async () => {
    inviteWorkerCore.mockImplementationOnce(async () => ({ success: false, error: 'insert failed' }));
    const { addBulkWorkersChunk } = await ACTIONS();
    const result = await addBulkWorkersChunk({ rows: rows(3), workerType: 'employee', confirmedTeamSize: 48 });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.results.map((r) => r.outcome)).toEqual(['failed', 'invited', 'invited']);
  });

  it('never creates a row that fails the server-side check', async () => {
    const { addBulkWorkersChunk } = await ACTIONS();
    const bad = [{ line: 1, name: 'Bad Phone', phone: '12', postcode: 'M3 2ER', email: 'bad@example.com' }];
    const result = await addBulkWorkersChunk({ rows: bad, workerType: 'employee', confirmedTeamSize: 48 });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.results[0]).toMatchObject({ outcome: 'failed', error: "Phone number doesn't look right" });
    expect(createWorkerCore).not.toHaveBeenCalled();
  });

  it('refuses a chunk over ten rows, a bad type, and non-owners', async () => {
    const { addBulkWorkersChunk } = await ACTIONS();
    expect(await addBulkWorkersChunk({ rows: rows(11), workerType: 'employee', confirmedTeamSize: 99 })).toMatchObject({ ok: false, code: 'bad_input' });
    expect(await addBulkWorkersChunk({ rows: rows(1), workerType: 'platform_solo' as never, confirmedTeamSize: 99 })).toMatchObject({ ok: false, code: 'bad_input' });
    role = 'worker';
    expect(await addBulkWorkersChunk({ rows: rows(1), workerType: 'employee', confirmedTeamSize: 99 })).toMatchObject({ ok: false, code: 'not_allowed' });
  });
});

describe('finishBulkAdd', () => {
  function forty() {
    const ids = Array.from({ length: 40 }, (_, i) => `w${i + 1}`);
    workersForFinish = ids.map((id, i) => ({ id, full_name: `Worker ${i + 1}`, email: `w${i + 1}@example.com`, worker_type: i % 2 ? 'employee' : 'company_subcontractor', invite_status: 'pending' }));
    invitesForFinish = ids.map((id) => ({ worker_id: id, token: `tok_${id}` }));
    return ids;
  }

  it('sends all 40 emails in ONE batch call, records ONE consent and reconciles ONCE', async () => {
    const ids = forty();
    countTeamWorkers.mockResolvedValue(48); // 8 before + 40
    const { finishBulkAdd } = await ACTIONS();
    const result = await finishBulkAdd({ workerIds: ids, confirmedTeamSize: 48 });
    expect(result).toEqual({ ok: true, emailed: 40, emailFailed: [] });
    expect(batchSend).toHaveBeenCalledTimes(1);
    expect(batchSend.mock.calls[0][0]).toHaveLength(40);
    expect(batchSend.mock.calls[0][0][0]).toMatchObject({ from: 'noreply@test', to: 'w1@example.com' });
    expect(recordExtraWorkerConsent).toHaveBeenCalledTimes(1);
    expect(recordExtraWorkerConsent.mock.calls[0][0]).toMatchObject({ tenantId: 'tenant_1', userId: 'user_1', notice: { workerNumber: 48, included: 10 } });
    expect(reconcileExtraWorkersAfterChange).toHaveBeenCalledTimes(1);
  });

  it('writes no consent when the whole batch was already paid for at sign-up', async () => {
    const ids = forty();
    countTeamWorkers.mockResolvedValue(48);
    paidFor = 48;
    const { finishBulkAdd } = await ACTIONS();
    const result = await finishBulkAdd({ workerIds: ids, confirmedTeamSize: 48 });
    expect(result.ok).toBe(true);
    expect(recordExtraWorkerConsent).not.toHaveBeenCalled();
  });

  it('still writes a consent when the batch went beyond what was paid for', async () => {
    const ids = forty();
    countTeamWorkers.mockResolvedValue(48);
    paidFor = 40;
    const { finishBulkAdd } = await ACTIONS();
    await finishBulkAdd({ workerIds: ids, confirmedTeamSize: 48 });
    expect(recordExtraWorkerConsent).toHaveBeenCalledTimes(1);
  });

  it('writes no consent when the team is still within the allowance, and none for a manual account', async () => {
    const ids = forty().slice(0, 2);
    countTeamWorkers.mockResolvedValue(9);
    const { finishBulkAdd } = await ACTIONS();
    await finishBulkAdd({ workerIds: ids, confirmedTeamSize: 9 });
    expect(recordExtraWorkerConsent).not.toHaveBeenCalled();
    loadProSubscription.mockResolvedValue(manualRow);
    countTeamWorkers.mockResolvedValue(500);
    await finishBulkAdd({ workerIds: ids, confirmedTeamSize: 500 });
    expect(recordExtraWorkerConsent).not.toHaveBeenCalled();
  });

  it('reports every email in a failed batch so they can be resent from the Invited tab', async () => {
    const ids = forty().slice(0, 3);
    countTeamWorkers.mockResolvedValue(11);
    batchSend.mockResolvedValue({ data: null, error: { message: 'resend down' } });
    const { finishBulkAdd } = await ACTIONS();
    const result = await finishBulkAdd({ workerIds: ids, confirmedTeamSize: 11 });
    expect(result.ok).toBe(true);
    expect(result.emailed).toBe(0);
    expect(result.emailFailed.map((f) => f.workerId)).toEqual(['w1', 'w2', 'w3']);
    expect(reconcileExtraWorkersAfterChange).toHaveBeenCalledTimes(1);
  });

  it('reports a worker with no invite token as an email failure instead of sending nothing silently', async () => {
    const ids = forty().slice(0, 2);
    invitesForFinish = [{ worker_id: 'w1', token: 'tok_w1' }];
    countTeamWorkers.mockResolvedValue(10);
    const { finishBulkAdd } = await ACTIONS();
    const result = await finishBulkAdd({ workerIds: ids, confirmedTeamSize: 10 });
    expect(result.emailed).toBe(1);
    expect(result.emailFailed).toEqual([{ workerId: 'w2' }]);
  });

  it('never throws, and refuses non-owners', async () => {
    const { finishBulkAdd } = await ACTIONS();
    role = 'worker';
    expect(await finishBulkAdd({ workerIds: ['w1'], confirmedTeamSize: 1 })).toMatchObject({ ok: false, error: 'Only the account owner can add workers.' });
    role = 'admin';
    getTenantProducts.mockRejectedValue(new Error('boom'));
    expect(await finishBulkAdd({ workerIds: ['w1'], confirmedTeamSize: 1 })).toMatchObject({ ok: false });
  });
});
