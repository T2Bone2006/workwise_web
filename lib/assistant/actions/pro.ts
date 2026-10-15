import 'server-only';

import { z } from 'zod';
import { defineAction, type Executed } from '@/lib/assistant/actions/types';
import type { AssistantCtx } from '@/lib/assistant/caller';
import { asText, dayLabel } from '@/lib/assistant/format';
import { STATUS_LABEL, asStatus } from '@/lib/assistant/tools/read-pro';
import { assignWorkerToJobIds } from '@/lib/jobs/assign-worker-to-jobs';
import { canAssignWorkerInline } from '@/lib/jobs/worker-assignment-status';
import { isValidYmd } from '@/lib/rounds/dates';

const ymd = z.string().refine(isValidYmd, 'Use YYYY-MM-DD');
const jobIds = z.array(z.string().uuid()).min(1).max(25);

type Raw = Record<string, unknown>;

type JobFacts = {
  id: string;
  ref: string;
  status: string;
  priority: string;
  address: string;
  date: string | null;
  time: string | null;
  endTime: string | null;
  workerId: string | null;
  workerName: string | null;
};

function facts(r: Raw): JobFacts {
  const w = Array.isArray(r.worker) ? r.worker[0] : r.worker;
  return {
    id: String(r.id),
    ref: asText(r.reference_number) ?? String(r.id).slice(0, 8).toUpperCase(),
    status: String(r.status ?? 'pending'),
    priority: String(r.priority ?? 'normal'),
    address: [asText(r.address), asText(r.postcode)].filter(Boolean).join(', '),
    date: asText(r.scheduled_date)?.slice(0, 10) ?? null,
    time: asText(r.scheduled_time)?.slice(0, 5) ?? null,
    endTime: asText(r.end_time)?.slice(0, 5) ?? null,
    workerId: asText(r.assigned_worker_id),
    workerName: asText((w as Raw | null)?.full_name),
  };
}

/** The tenant's jobs by id, in the order asked. Null if any is missing or the read failed. */
async function loadJobs(ctx: AssistantCtx, ids: string[]): Promise<JobFacts[] | null> {
  const unique = [...new Set(ids)];
  const { data, error } = await ctx.db
    .from('jobs')
    .select('id, reference_number, status, priority, address, postcode, scheduled_date, scheduled_time, end_time, assigned_worker_id, worker:workers!assigned_worker_id(id, full_name)')
    .eq('tenant_id', ctx.tenantId)
    .in('id', unique);
  if (error) return null;
  const byId = new Map(((data ?? []) as Raw[]).map((r) => [String(r.id), facts(r)]));
  if (unique.some((id) => !byId.has(id))) return null;
  return unique.map((id) => byId.get(id)!);
}

const JOBS_GONE = 'One of those jobs is no longer there. Look them up again.';
const SHOWN_LINES = 6;

function cap(lines: string[], total: number): string[] {
  return total > SHOWN_LINES ? [...lines.slice(0, SHOWN_LINES), `…and ${total - SHOWN_LINES} more`] : lines;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function dayAndTime(date: string | null, time: string | null): string {
  return [date && isValidYmd(date) ? dayLabel(date) : 'no day', time].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------

type AssignParams = { jobIds: string[]; workerId: string; workerName: string };

export const assignJobs = defineAction({
  name: 'assign_jobs',
  description:
    'Propose giving one or more jobs to a worker (also moves a job from one worker to another). They become "Ready to send": the worker is not told until the office taps Send out on the Jobs page. Only for jobs not started yet (not assigned, ready to send, sent, or declined). Look up job_ids and the worker_id first; the worker must have accepted their invite.',
  product: 'pro',
  status: 'Getting the assignment ready',
  schema: z.object({ job_ids: jobIds, worker_id: z.string().uuid() }),
  async prepare(ctx, input) {
    const { data: worker } = await ctx.db
      .from('workers')
      .select('id, full_name, invite_status')
      .eq('id', input.worker_id)
      .eq('primary_tenant_id', ctx.tenantId)
      .maybeSingle();
    if (!worker) return { ok: false, error: 'No worker with that id.' };
    const w = worker as Raw;
    if (w.invite_status !== 'accepted') return { ok: false, error: `${asText(w.full_name) ?? 'That worker'} hasn't accepted their invite yet, so they can't be given jobs.` };
    const name = asText(w.full_name) ?? 'the worker';

    const jobs = await loadJobs(ctx, input.job_ids);
    if (!jobs) return { ok: false, error: JOBS_GONE };
    const stuck = jobs.filter((j) => !canAssignWorkerInline(j.status));
    if (stuck.length > 0) {
      return {
        ok: false,
        error: `${stuck.map((j) => `${j.ref} (${STATUS_LABEL[asStatus(j.status)]})`).join(', ')} can't be handed over from here: a job that has started or finished is changed on its own job page.`,
      };
    }
    // Already with this worker and waiting on them: nothing to do for those.
    const todo = jobs.filter((j) => !(j.workerId === input.worker_id && (j.status === 'pending_send' || j.status === 'assigned')));
    if (todo.length === 0) return { ok: false, error: `${jobs.length === 1 ? `${jobs[0]!.ref} is` : 'Those jobs are'} already with ${name}.` };

    const lines = todo.map((j) => `${j.ref} · ${j.address || 'no address'}${j.date ? ` · ${dayAndTime(j.date, j.time)}` : ''}${j.workerName ? ` (now ${j.workerName})` : ''}`);
    const takenFromSomeone = todo.filter((j) => j.status === 'assigned' && j.workerId && j.workerId !== input.worker_id);
    return {
      ok: true,
      params: { jobIds: todo.map((j) => j.id), workerId: input.worker_id, workerName: name } satisfies AssignParams,
      preview: {
        title: `Give ${plural(todo.length, 'job')} to ${name}`,
        lines: cap(lines, lines.length),
        confirmLabel: `Give to ${name.split(' ')[0]}`,
        tone: 'sky',
        note: takenFromSomeone.length > 0
          ? `${name.split(' ')[0]} isn't told yet: tap Send out on Jobs. ${plural(takenFromSomeone.length, 'job')} already sent to someone else will leave their app straight away.`
          : `${name.split(' ')[0]} isn't told yet: the jobs show as Ready to send, and you tap Send out on Jobs.`,
        href: '/jobs',
      },
    };
  },
  async execute(ctx, p: AssignParams): Promise<Executed> {
    // Things change between the card and the tap: check again.
    const jobs = await loadJobs(ctx, p.jobIds);
    if (!jobs) return { ok: false, error: JOBS_GONE };
    const stuck = jobs.filter((j) => !canAssignWorkerInline(j.status));
    if (stuck.length > 0) return { ok: false, error: `${stuck.map((j) => j.ref).join(', ')} changed while the card was open, so nothing was changed. Ask me again.` };
    const r = await assignWorkerToJobIds(ctx.db as Parameters<typeof assignWorkerToJobIds>[0], ctx.tenantId, p.jobIds, p.workerId);
    if (!r.success) return { ok: false, error: r.error };
    return { ok: true, result: `Gave ${plural(r.assigned, 'job')} to ${p.workerName}. ${r.assigned === 1 ? 'It is' : 'They are'} ready to send.`, href: '/jobs' };
  },
});

// ---------------------------------------------------------------------------

type Change = { id: string; ref: string; from: { date: string | null; time: string | null; end: string | null }; to: { date: string; time: string | null; end: string | null } };
type RescheduleParams = { changes: Change[] };

const NOT_MOVABLE = new Set(['completed', 'cancelled']);

export const rescheduleJobs = defineAction({
  name: 'reschedule_jobs',
  description:
    'Propose moving one or more jobs to another day (and optionally a start time, 24-hour HH:MM, which clears any finish time). Not for finished or cancelled jobs. The worker is not messaged; their app simply shows the new day. Look the job_ids up first.',
  product: 'pro',
  status: 'Getting the new day ready',
  schema: z.object({ job_ids: jobIds, date: ymd, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM').optional() }),
  async prepare(ctx, input) {
    if (input.date < ctx.today) return { ok: false, error: `${dayLabel(input.date)} has already passed.` };
    const jobs = await loadJobs(ctx, input.job_ids);
    if (!jobs) return { ok: false, error: JOBS_GONE };
    const stuck = jobs.filter((j) => NOT_MOVABLE.has(j.status));
    if (stuck.length > 0) return { ok: false, error: `${stuck.map((j) => `${j.ref} (${STATUS_LABEL[asStatus(j.status)]})`).join(', ')} can't be moved.` };
    const changes: Change[] = jobs
      .filter((j) => !(j.date === input.date && (!input.time || j.time === input.time)))
      .map((j) => ({
        id: j.id,
        ref: j.ref,
        from: { date: j.date, time: j.time, end: j.endTime },
        to: { date: input.date, time: input.time ?? j.time, end: input.time ? null : j.endTime },
      }));
    if (changes.length === 0) return { ok: false, error: `${jobs.length === 1 ? `${jobs[0]!.ref} is` : 'Those jobs are'} already then.` };
    const withWorker = jobs.filter((j) => j.workerId && changes.some((c) => c.id === j.id));
    return {
      ok: true,
      params: { changes } satisfies RescheduleParams,
      preview: {
        title: `Move ${plural(changes.length, 'job')} to ${dayLabel(input.date)}${input.time ? ` at ${input.time}` : ''}`,
        lines: cap(changes.map((c) => `${c.ref} · ${dayAndTime(c.from.date, c.from.time)} → ${dayAndTime(c.to.date, c.to.time)}`), changes.length),
        confirmLabel: 'Move them',
        tone: 'sky',
        note: withWorker.length > 0 ? 'Nobody is messaged. The worker\'s app shows the new day.' : undefined,
        href: '/jobs',
      },
    };
  },
  async execute(ctx, p: RescheduleParams): Promise<Executed> {
    const now = new Date().toISOString();
    let moved = 0;
    const left: string[] = [];
    for (const c of p.changes) {
      const { data, error } = await ctx.db
        .from('jobs')
        .update({ scheduled_date: c.to.date, scheduled_time: c.to.time, end_time: c.to.end, updated_at: now })
        .eq('id', c.id)
        .eq('tenant_id', ctx.tenantId)
        .not('status', 'in', '(completed,cancelled)')
        .select('id');
      if (error || !data || data.length === 0) left.push(c.ref);
      else moved += 1;
    }
    if (moved === 0) return { ok: false, error: 'None of them could be moved: they may have finished or been removed.' };
    const movedChanges = p.changes.filter((c) => !left.includes(c.ref));
    return {
      ok: true,
      result: `Moved ${plural(moved, 'job')} to ${dayLabel(p.changes[0]!.to.date)}.${left.length > 0 ? ` Couldn't move ${left.join(', ')}.` : ''}`,
      data: { moved: movedChanges },
      href: '/jobs',
    };
  },
  async undo(ctx, _p: RescheduleParams, saved) {
    const moved = (saved.data.moved ?? []) as Change[];
    const now = new Date().toISOString();
    let back = 0;
    for (const c of moved) {
      // Only if it is still where we put it: someone may have moved it again since.
      const { data } = await ctx.db
        .from('jobs')
        .update({ scheduled_date: c.from.date, scheduled_time: c.from.time, end_time: c.from.end, updated_at: now })
        .eq('id', c.id)
        .eq('tenant_id', ctx.tenantId)
        .eq('scheduled_date', c.to.date)
        .select('id');
      if (data && data.length > 0) back += 1;
    }
    if (back === 0) return { ok: false, error: 'They have been changed since, so there is nothing to put back.' };
    return { ok: true, result: `Put ${plural(back, 'job')} back.` };
  },
});

// ---------------------------------------------------------------------------

const PRIORITIES = ['low', 'normal', 'high', 'emergency'] as const;
type PriorityParams = { changes: Array<{ id: string; ref: string; from: string }>; priority: (typeof PRIORITIES)[number] };

export const setJobPriority = defineAction({
  name: 'set_job_priority',
  description: 'Propose changing how urgent one or more jobs are: low, normal, high or emergency.',
  product: 'pro',
  status: 'Getting the change ready',
  schema: z.object({ job_ids: jobIds, priority: z.enum(PRIORITIES) }),
  async prepare(ctx, input) {
    const jobs = await loadJobs(ctx, input.job_ids);
    if (!jobs) return { ok: false, error: JOBS_GONE };
    const todo = jobs.filter((j) => j.priority !== input.priority && !NOT_MOVABLE.has(j.status));
    if (todo.length === 0) return { ok: false, error: `${jobs.length === 1 ? `${jobs[0]!.ref} is` : 'Those jobs are'} already ${input.priority}, or finished.` };
    return {
      ok: true,
      params: { changes: todo.map((j) => ({ id: j.id, ref: j.ref, from: j.priority })), priority: input.priority } satisfies PriorityParams,
      preview: {
        title: `Mark ${plural(todo.length, 'job')} as ${input.priority}`,
        lines: cap(todo.map((j) => `${j.ref} · ${j.priority} → ${input.priority}`), todo.length),
        confirmLabel: `Mark ${input.priority}`,
        tone: input.priority === 'emergency' || input.priority === 'high' ? 'amber' : 'slate',
        href: '/jobs',
      },
    };
  },
  async execute(ctx, p: PriorityParams): Promise<Executed> {
    const { data, error } = await ctx.db
      .from('jobs')
      .update({ priority: p.priority, updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .in('id', p.changes.map((c) => c.id))
      .not('status', 'in', '(completed,cancelled)')
      .select('id');
    if (error) return { ok: false, error: 'Could not save that.' };
    const n = data?.length ?? 0;
    if (n === 0) return { ok: false, error: 'Those jobs have finished or gone, so nothing was changed.' };
    return { ok: true, result: `Marked ${plural(n, 'job')} as ${p.priority}.`, href: '/jobs' };
  },
});

// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FINISHED = new Set(['completed', 'incomplete', 'declined']);
type EmailParams = { jobId: string; ref: string; recipient: string; note: string | null };

export const emailJobOutcome = defineAction({
  name: 'email_job_outcome',
  description:
    'Propose emailing the summary of a finished job (done, not completed or declined: what was found, the worker\'s report, the reason) to an address. Use an address they gave you, or the job\'s customer email from get_job. Nothing is sent until they tap the button.',
  product: 'pro',
  status: 'Getting the email ready',
  schema: z.object({ job_id: z.string().uuid(), recipient: z.string().max(200), note: z.string().max(400).optional().describe('A line from the office shown above the summary.') }),
  async prepare(ctx, input) {
    const recipient = input.recipient.trim();
    if (!EMAIL_RE.test(recipient)) return { ok: false, error: `"${recipient}" isn't an email address.` };
    const jobs = await loadJobs(ctx, [input.job_id]);
    if (!jobs) return { ok: false, error: JOBS_GONE };
    const job = jobs[0]!;
    if (!FINISHED.has(job.status)) return { ok: false, error: `${job.ref} hasn't finished yet (${STATUS_LABEL[asStatus(job.status)]}), so there's no summary to send.` };
    const note = input.note?.trim() || null;
    return {
      ok: true,
      params: { jobId: job.id, ref: job.ref, recipient, note } satisfies EmailParams,
      preview: {
        title: `Email the summary of ${job.ref}`,
        lines: [`To: ${recipient}`, `${job.ref} · ${STATUS_LABEL[asStatus(job.status)]}${job.address ? ` · ${job.address}` : ''}`, ...(note ? [`Your note: ${note}`] : [])],
        confirmLabel: 'Send email',
        tone: 'sky',
        note: 'The same email WorkWise sends automatically: what happened, the worker\'s report and photos.',
        href: `/jobs/${job.id}`,
      },
    };
  },
  async execute(ctx, p: EmailParams): Promise<Executed> {
    const jobs = await loadJobs(ctx, [p.jobId]);
    if (!jobs) return { ok: false, error: JOBS_GONE };
    if (!FINISHED.has(jobs[0]!.status)) return { ok: false, error: `${p.ref} is no longer finished, so nothing was sent.` };
    // Loaded here, not at the top: the mail client needs its API key the moment it is imported.
    const { sendJobOutcomeEmail } = await import('@/lib/jobs/send-job-outcome-email');
    const r = await sendJobOutcomeEmail({ jobId: p.jobId, recipients: [p.recipient], note: p.note, automatic: false });
    if (!r.sent) return { ok: false, error: r.error ? `The email didn't go: ${r.error}` : "The email didn't go." };
    return { ok: true, result: `Emailed the summary of ${p.ref} to ${p.recipient}.`, href: `/jobs/${p.jobId}` };
  },
});

export const PRO_ACTIONS = [assignJobs, rescheduleJobs, setJobPriority, emailJobOutcome];
