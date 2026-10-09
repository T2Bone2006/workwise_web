import { describe, expect, it } from 'vitest';
import { assignJobs, emailJobOutcome, rescheduleJobs, setJobPriority } from '@/lib/assistant/actions/pro';
import { covers, type AssistantCtx } from '@/lib/assistant/caller';
import { buildSystemPrompt, contextLine } from '@/lib/assistant/prompt';
import { anthropicTools, toolsFor } from '@/lib/assistant/registry';
import { briefJob, totalsFor } from '@/lib/assistant/tools/read-pro';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const W = '33333333-3333-4333-8333-333333333333';

/** A database stand-in: every query on a table answers with that table's rows, whatever the filters. */
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>) {
  const chain = (rows: Array<Record<string, unknown>>): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'not', 'is', 'order', 'limit', 'ilike', 'or', 'gte', 'lte']) q[m] = () => q;
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
    return q;
  };
  return { from: (t: string) => chain(tables[t] ?? []) };
}

function ctxWith(tables: Record<string, Array<Record<string, unknown>>>, over: Partial<AssistantCtx> = {}): AssistantCtx {
  const db = fakeDb(tables);
  return { db, admin: db, tenantId: 't1', userId: 'u1', hasRounds: false, hasLite: false, hasPro: true, surface: 'web', today: '2026-10-08', ...over } as unknown as AssistantCtx;
}

const job = (over: Record<string, unknown> = {}) => ({
  id: A,
  reference_number: 'RS-1001',
  status: 'pending',
  priority: 'normal',
  address: '12 High Street',
  postcode: 'BS1 1AA',
  scheduled_date: '2026-10-09',
  scheduled_time: '09:00:00',
  end_time: null,
  assigned_worker_id: null,
  worker: null,
  ...over,
});

const dave = { id: W, full_name: 'Dave Jones', invite_status: 'accepted' };

describe('the Pro prompt and tool set', () => {
  it('describes a dispatch office, not a self-employed trader', () => {
    const p = buildSystemPrompt({ hasRounds: false, hasLite: false, hasPro: true, surface: 'web' });
    expect(p).toContain('send jobs to its team');
    expect(p).toContain('Ready to send');
    expect(p).not.toContain('tradesperson');
    expect(p).not.toContain('visit');
    // Business-agnostic and short, so one cached copy serves every Pro business.
    expect(p.length).toBeLessThan(4200);
    expect(buildSystemPrompt({ hasRounds: false, hasLite: false, hasPro: true, surface: 'web' })).toBe(p);
  });

  it('leaves the Rounds prompt exactly as it was', () => {
    const rounds = buildSystemPrompt({ hasRounds: true, hasLite: false, surface: 'web' });
    expect(rounds).toContain('self-employed tradesperson');
    expect(rounds).not.toContain('Ready to send');
  });

  it('offers only the Pro tools to a Pro office, with no repeated names', () => {
    const names = toolsFor({ rounds: false, lite: false, pro: true }).map((t) => t.name);
    expect(names).toEqual([
      'how_to',
      'find_jobs',
      'get_job',
      'jobs_needing_attention',
      'list_workers',
      'worker_workload',
      'find_job_customers',
      'job_numbers',
      'assign_jobs',
      'reschedule_jobs',
      'set_job_priority',
      'email_job_outcome',
    ]);
    const both = toolsFor({ rounds: true, lite: false, pro: true }).map((t) => t.name);
    expect(new Set(both).size).toBe(both.length);
    expect(toolsFor({ rounds: true, lite: true }).map((t) => t.name)).not.toContain('find_jobs');
  });

  it('turns every Pro tool into an object schema with a real description', () => {
    for (const tool of anthropicTools(toolsFor({ rounds: false, lite: false, pro: true }))) {
      expect(tool.input_schema.type).toBe('object');
      expect(tool.description?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('covers a tool only when the plan has its product', () => {
    const pro = { hasRounds: false, hasLite: false, hasPro: true };
    expect(covers(pro, 'pro')).toBe(true);
    expect(covers(pro, 'rounds')).toBe(false);
    expect(covers(pro, 'any')).toBe(true);
    expect(covers({ hasRounds: true, hasLite: false, hasPro: false }, 'pro')).toBe(false);
  });

  it('tells Claude which job or worker page they are on', () => {
    const line = contextLine('2026-10-08', { path: `/jobs/${A}`, jobId: A, label: 'This job' });
    expect(line).toContain(`job_id ${A}`);
    expect(contextLine('2026-10-08', { path: `/workers/${W}`, workerId: W })).toContain(`worker_id ${W}`);
  });
});

describe('reading jobs', () => {
  it('shortens a job to what is needed to talk about it', () => {
    const j = briefJob(
      { ...job({ priority: 'emergency', assigned_worker_id: W, status: 'assigned' }), customer: { id: 'c', name: 'Acme Ltd' }, worker: { full_name: 'Dave Jones' } },
      '2026-10-08',
    );
    expect(j).toMatchObject({ reference: 'RS-1001', status_label: 'Sent to worker', customer: 'Acme Ltd', worker: 'Dave Jones', date: 'tomorrow', time: '09:00', priority: 'emergency', needs_worker: false });
    expect(j.address).toBe('12 High Street, BS1 1AA');
  });

  it('only calls a job "needs a worker" when it is pending, unassigned and not with the network', () => {
    expect(briefJob(job(), '2026-10-08').needs_worker).toBe(true);
    expect(briefJob(job({ network_dispatch_id: 'n1' }), '2026-10-08').needs_worker).toBe(false);
    expect(briefJob(job({ status: 'declined' }), '2026-10-08').needs_worker).toBe(false);
  });

  it('counts by outcome and leaves cancelled jobs out of the total', () => {
    expect(totalsFor([{ status: 'completed' }, { status: 'completed' }, { status: 'incomplete' }, { status: 'declined' }, { status: 'cancelled' }, { status: 'assigned' }])).toEqual({
      total: 5,
      done: 2,
      not_completed: 1,
      declined: 1,
      cancelled: 1,
      open: 1,
    });
  });
});

describe('assign_jobs', () => {
  it('shows a Do it card that says the worker is not told yet', async () => {
    const ctx = ctxWith({ workers: [dave], jobs: [job()] });
    const r = await assignJobs.prepare(ctx, { job_ids: [A], worker_id: W });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.title).toBe('Give 1 job to Dave Jones');
    expect(r.preview.note).toContain("isn't told yet");
    expect(r.params).toMatchObject({ jobIds: [A], workerId: W });
  });

  it('refuses a worker who has not accepted their invite', async () => {
    const ctx = ctxWith({ workers: [{ ...dave, invite_status: 'pending' }], jobs: [job()] });
    const r = await assignJobs.prepare(ctx, { job_ids: [A], worker_id: W });
    expect(r).toEqual({ ok: false, error: "Dave Jones hasn't accepted their invite yet, so they can't be given jobs." });
  });

  it('refuses jobs that have started or finished', async () => {
    const ctx = ctxWith({ workers: [dave], jobs: [job({ status: 'in_progress' })] });
    const r = await assignJobs.prepare(ctx, { job_ids: [A], worker_id: W });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('RS-1001 (In progress)');
  });

  it('has nothing to do when the job is already with that worker', async () => {
    const ctx = ctxWith({ workers: [dave], jobs: [job({ status: 'pending_send', assigned_worker_id: W })] });
    const r = await assignJobs.prepare(ctx, { job_ids: [A], worker_id: W });
    expect(r).toEqual({ ok: false, error: 'RS-1001 is already with Dave Jones.' });
  });

  it('warns that a job already sent to someone else leaves their app', async () => {
    const other = '44444444-4444-4444-8444-444444444444';
    const ctx = ctxWith({ workers: [dave], jobs: [job({ status: 'assigned', assigned_worker_id: other, worker: { full_name: 'Sam' } })] });
    const r = await assignJobs.prepare(ctx, { job_ids: [A], worker_id: W });
    expect(r.ok && r.preview.note).toContain('leave their app');
    expect(r.ok && r.preview.lines[0]).toContain('(now Sam)');
  });

  it('says so when a job id is not theirs', async () => {
    const ctx = ctxWith({ workers: [dave], jobs: [job()] });
    const r = await assignJobs.prepare(ctx, { job_ids: [A, B], worker_id: W });
    expect(r.ok).toBe(false);
  });
});

describe('reschedule_jobs', () => {
  it('shows the old and new day for each job, and tells nobody', async () => {
    const ctx = ctxWith({ jobs: [job({ assigned_worker_id: W, status: 'assigned' })] });
    const r = await rescheduleJobs.prepare(ctx, { job_ids: [A], date: '2026-10-12', time: '14:30' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.title).toBe('Move 1 job to Mon 12 Oct at 14:30');
    expect(r.preview.lines[0]).toBe('RS-1001 · Fri 9 Oct 09:00 → Mon 12 Oct 14:30');
    expect(r.preview.note).toContain('Nobody is messaged');
  });

  it('keeps the time when only the day changes, and clears the finish time when the start changes', async () => {
    const ctx = ctxWith({ jobs: [job({ end_time: '11:00:00' })] });
    const sameTime = await rescheduleJobs.prepare(ctx, { job_ids: [A], date: '2026-10-12' });
    expect(sameTime.ok && (sameTime.params as { changes: Array<{ to: unknown }> }).changes[0]!.to).toEqual({ date: '2026-10-12', time: '09:00', end: '11:00' });
    const newTime = await rescheduleJobs.prepare(ctx, { job_ids: [A], date: '2026-10-12', time: '13:00' });
    expect(newTime.ok && (newTime.params as { changes: Array<{ to: unknown }> }).changes[0]!.to).toEqual({ date: '2026-10-12', time: '13:00', end: null });
  });

  it('refuses a day that has passed, finished jobs and no-op moves', async () => {
    expect(await rescheduleJobs.prepare(ctxWith({ jobs: [job()] }), { job_ids: [A], date: '2026-10-07' })).toEqual({ ok: false, error: 'Wed 7 Oct has already passed.' });
    const done = await rescheduleJobs.prepare(ctxWith({ jobs: [job({ status: 'completed' })] }), { job_ids: [A], date: '2026-10-12' });
    expect(done.ok).toBe(false);
    const same = await rescheduleJobs.prepare(ctxWith({ jobs: [job()] }), { job_ids: [A], date: '2026-10-09' });
    expect(same).toEqual({ ok: false, error: 'RS-1001 is already then.' });
  });

  it('rejects a time that is not HH:MM', () => {
    expect(rescheduleJobs.schema.safeParse({ job_ids: [A], date: '2026-10-12', time: '9am' }).success).toBe(false);
    expect(rescheduleJobs.schema.safeParse({ job_ids: [A], date: '2026-13-45' }).success).toBe(false);
  });
});

describe('set_job_priority and email_job_outcome', () => {
  it('skips jobs already at that priority', async () => {
    const r = await setJobPriority.prepare(ctxWith({ jobs: [job({ priority: 'high' })] }), { job_ids: [A], priority: 'high' });
    expect(r.ok).toBe(false);
    const ok = await setJobPriority.prepare(ctxWith({ jobs: [job()] }), { job_ids: [A], priority: 'emergency' });
    expect(ok.ok && ok.preview.title).toBe('Mark 1 job as emergency');
  });

  it('only emails a real address about a job that has finished', async () => {
    const finished = ctxWith({ jobs: [job({ status: 'incomplete' })] });
    expect((await emailJobOutcome.prepare(finished, { job_id: A, recipient: 'not-an-email' })).ok).toBe(false);
    const open = await emailJobOutcome.prepare(ctxWith({ jobs: [job({ status: 'assigned' })] }), { job_id: A, recipient: 'customer@example.com' });
    expect(open.ok).toBe(false);
    const good = await emailJobOutcome.prepare(finished, { job_id: A, recipient: ' customer@example.com ', note: 'Sorry about that' });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.preview.lines).toEqual(['To: customer@example.com', 'RS-1001 · Not completed · 12 High Street, BS1 1AA', 'Your note: Sorry about that']);
    expect(good.preview.confirmLabel).toBe('Send email');
  });
});
