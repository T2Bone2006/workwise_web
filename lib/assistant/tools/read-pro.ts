import 'server-only';

import { z } from 'zod';
import type { AssistantCtx } from '@/lib/assistant/caller';
import { asText, dayLabel, friendlyDay, searchTerm } from '@/lib/assistant/format';
import type { AssistantCard, CardTone, ListCard } from '@/lib/assistant/shared';
import { defineTool, ok, toolError } from '@/lib/assistant/tools/types';
import { readAllPages } from '@/lib/data/read-all-pages';
import { getJobOutcomeSummary } from '@/lib/jobs/job-outcome-summary';
import { summariseDay } from '@/lib/jobs/pro-day';
import { addDays, diffDays, isValidYmd, type Ymd } from '@/lib/rounds/dates';

const ymd = z.string().refine(isValidYmd, 'Use YYYY-MM-DD');

export const JOB_STATUSES = ['pending', 'pending_send', 'assigned', 'in_progress', 'paused', 'completed', 'incomplete', 'declined', 'cancelled'] as const;
export type ProJobStatus = (typeof JOB_STATUSES)[number];

/** What the office sees, and the one colour each status keeps everywhere (declined rose, not completed amber…). */
export const STATUS_LABEL: Record<ProJobStatus, string> = {
  pending: 'Not assigned',
  pending_send: 'Ready to send',
  assigned: 'Sent to worker',
  in_progress: 'In progress',
  paused: 'Paused',
  completed: 'Done',
  incomplete: 'Not completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

export const STATUS_TONE: Record<ProJobStatus, CardTone> = {
  pending: 'slate',
  pending_send: 'sky',
  assigned: 'indigo',
  in_progress: 'teal',
  paused: 'amber',
  completed: 'emerald',
  incomplete: 'amber',
  declined: 'rose',
  cancelled: 'slate',
};

/** Jobs still to be done by someone (not finished, not cancelled). */
const OPEN_STATUSES: ProJobStatus[] = ['pending', 'pending_send', 'assigned', 'in_progress', 'paused', 'declined', 'incomplete'];

const JOB_COLUMNS =
  'id, reference_number, status, priority, address, postcode, job_description, scheduled_date, scheduled_time, assigned_worker_id, network_dispatch_id, decline_reason';
const WORKER_EMBED = 'worker:workers!assigned_worker_id(id, full_name)';
const JOB_SELECT = `${JOB_COLUMNS}, customer:customers!customer_id(id, name), ${WORKER_EMBED}`;

type Raw = Record<string, unknown>;

export function asStatus(v: unknown): ProJobStatus {
  return (JOB_STATUSES as readonly string[]).includes(String(v)) ? (v as ProJobStatus) : 'pending';
}

function one(v: unknown): Raw | null {
  const x = Array.isArray(v) ? v[0] : v;
  return x && typeof x === 'object' ? (x as Raw) : null;
}

/** "14:30:00" → "14:30". */
function hhmm(v: unknown): string | null {
  const t = asText(v);
  return t ? t.slice(0, 5) : null;
}

function ymdOf(v: unknown): Ymd | null {
  const t = asText(v)?.slice(0, 10);
  return t && isValidYmd(t) ? t : null;
}

export type JobBrief = {
  job_id: string;
  reference: string;
  status: ProJobStatus;
  status_label: string;
  priority?: string;
  customer: string | null;
  address: string;
  job: string;
  date: string | null;
  time: string | null;
  worker: string | null;
  worker_id: string | null;
  /** Ready to be given a worker and sent out (pending, nobody on it, not with the network). */
  needs_worker: boolean;
};

/** One compact row of a job: only what's needed to talk about it. Pure; exported for tests. */
export function briefJob(r: Raw, today: Ymd): JobBrief {
  const status = asStatus(r.status);
  const customer = one(r.customer);
  const worker = one(r.worker);
  const date = ymdOf(r.scheduled_date);
  const description = asText(r.job_description) ?? '';
  const address = [asText(r.address), asText(r.postcode)].filter(Boolean).join(', ');
  return {
    job_id: String(r.id),
    reference: asText(r.reference_number) ?? String(r.id).slice(0, 8).toUpperCase(),
    status,
    status_label: STATUS_LABEL[status],
    ...(r.priority && r.priority !== 'normal' ? { priority: String(r.priority) } : {}),
    customer: asText(customer?.name),
    address,
    job: description.length > 100 ? `${description.slice(0, 97).trimEnd()}…` : description,
    date: date ? friendlyDay(date, today) : null,
    time: hhmm(r.scheduled_time),
    worker: asText(worker?.full_name),
    worker_id: asText(r.assigned_worker_id),
    needs_worker: status === 'pending' && !r.assigned_worker_id && !r.network_dispatch_id,
  };
}

function jobListItem(j: JobBrief, extra?: { tag?: string; tone?: CardTone; subtitle?: string }): ListCard['items'][number] {
  const noWorker = j.needs_worker;
  return {
    id: j.job_id,
    title: `${j.reference}${j.customer ? ` · ${j.customer}` : ''}`,
    subtitle:
      extra?.subtitle ??
      [j.address || null, [j.date, j.time].filter(Boolean).join(' ') || null, j.worker ?? (noWorker ? 'no worker yet' : null)]
        .filter(Boolean)
        .join(' · '),
    tone: extra?.tone ?? (noWorker ? 'amber' : STATUS_TONE[j.status]),
    tag: extra?.tag ?? (noWorker ? 'No worker' : j.status_label),
    href: `/jobs/${j.job_id}`,
  };
}

const MAX_CARD_ROWS = 15;

// ---------------------------------------------------------------------------

export const findJobs = defineTool({
  name: 'find_jobs',
  description:
    'Find jobs by reference, address, postcode, customer or what the job is, and/or by status, worker, customer or scheduled dates. Gives the job_ids other tools need.',
  product: 'pro',
  status: 'Looking through your jobs',
  schema: z.object({
    query: z.string().max(80).optional().describe('Reference, address, postcode, customer or job wording.'),
    status: z.array(z.enum(JOB_STATUSES)).max(9).optional(),
    worker_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    unassigned: z.boolean().optional().describe('Only jobs with no worker.'),
    from: ymd.optional().describe('Scheduled on or after.'),
    to: ymd.optional().describe('Scheduled on or before.'),
    show: z.boolean().optional(),
  }),
  async run(ctx, input) {
    let q = ctx.db.from('jobs').select(JOB_SELECT, { count: 'exact' }).eq('tenant_id', ctx.tenantId);
    if (input.status?.length) q = q.in('status', input.status);
    if (input.worker_id) q = q.eq('assigned_worker_id', input.worker_id);
    if (input.customer_id) q = q.eq('customer_id', input.customer_id);
    if (input.unassigned) q = q.is('assigned_worker_id', null);
    // "No worker" means work waiting for someone: cancelled jobs are not that unless they ask for them.
    if (input.unassigned && !input.status?.length) q = q.neq('status', 'cancelled');
    if (input.from) q = q.gte('scheduled_date', input.from);
    if (input.to) q = q.lte('scheduled_date', input.to);

    const term = input.query ? searchTerm(input.query) : '';
    if (term) {
      const like = `%${term}%`;
      const { data: customers } = await ctx.db.from('customers').select('id').eq('tenant_id', ctx.tenantId).ilike('name', like).limit(40);
      const ids = (customers ?? []).map((c) => String((c as Raw).id));
      const clauses = [`reference_number.ilike.${like}`, `address.ilike.${like}`, `postcode.ilike.${like}`, `job_description.ilike.${like}`];
      if (ids.length > 0) clauses.push(`customer_id.in.(${ids.join(',')})`);
      q = q.or(clauses.join(','));
    }

    const dated = Boolean(input.from || input.to);
    q = dated
      ? q.order('scheduled_date', { ascending: true }).order('scheduled_time', { ascending: true, nullsFirst: false })
      : q.order('created_at', { ascending: false });
    const { data, error, count } = await q.limit(30);
    if (error) return toolError('Could not read jobs.');
    const jobs = ((data ?? []) as Raw[]).map((r) => briefJob(r, ctx.today));

    const cards: AssistantCard[] = [];
    if (input.show && jobs.length > 0) {
      cards.push({
        type: 'list',
        title: 'Jobs',
        items: jobs.slice(0, MAX_CARD_ROWS).map((j) => jobListItem(j)),
        footer: (count ?? jobs.length) > MAX_CARD_ROWS ? `${(count ?? jobs.length) - MAX_CARD_ROWS} more not shown` : undefined,
      });
    }
    return ok({ total_matching: count ?? jobs.length, showing: jobs.length, jobs }, { cards });
  },
});

// ---------------------------------------------------------------------------

type HistoryRow = { to_status: unknown; notes: unknown; created_at: unknown };

export const getJob = defineTool({
  name: 'get_job',
  description: 'Everything about one job: details, customer contact, worker, what happened (history), and for finished jobs the worker\'s report and the reason it stopped.',
  product: 'pro',
  status: 'Opening the job',
  schema: z.object({
    job_id: z.string().uuid().optional(),
    reference: z.string().max(40).optional().describe('The job reference, e.g. RS-1042, if you have no job_id.'),
  }),
  async run(ctx, input) {
    if (!input.job_id && !input.reference) return toolError('Give a job_id or a reference.');
    const select = `${JOB_COLUMNS}, customer_id, quoted_amount, final_amount, completion_notes, estimated_duration_minutes, customer:customers!customer_id(id, name, email, phone, company_name), ${WORKER_EMBED}`;
    let q = ctx.db.from('jobs').select(select).eq('tenant_id', ctx.tenantId);
    q = input.job_id ? q.eq('id', input.job_id) : q.ilike('reference_number', searchTerm(input.reference ?? ''));
    const { data, error } = await q.limit(2);
    if (error) return toolError('Could not read that job.');
    const rows = (data ?? []) as unknown as Raw[];
    if (rows.length === 0) return toolError('No job found.');
    if (rows.length > 1) return toolError('More than one job matches that reference. Use find_jobs and pick one.');
    const row = rows[0]!;
    const brief = briefJob(row, ctx.today);
    const customer = one(row.customer);

    const { data: history } = await ctx.db
      .from('job_status_history')
      .select('to_status, notes, created_at')
      .eq('job_id', brief.job_id)
      .order('created_at', { ascending: false })
      .limit(6);
    const happened = ((history ?? []) as HistoryRow[]).map((h) => ({
      when: typeof h.created_at === 'string' ? h.created_at.slice(0, 16).replace('T', ' ') : null,
      became: STATUS_LABEL[asStatus(h.to_status)],
      note: asText(h.notes),
    }));

    let report: Record<string, unknown> | undefined;
    if (brief.status === 'completed' || brief.status === 'incomplete' || brief.status === 'declined') {
      // The job is this tenant's (read above through RLS), so the service-role summary is safe to use.
      const { summary } = await getJobOutcomeSummary(brief.job_id);
      if (summary) {
        report = {
          reason: summary.reason,
          answers: summary.reportAnswers.slice(0, 12).map((a) => ({ question: a.label, answer: a.value.slice(0, 200) })),
          photos: summary.photoUrls.length,
          started: summary.startedAt,
          finished: summary.endedAt,
        };
      }
    }

    return ok({
      ...brief,
      customer_id: asText(row.customer_id),
      customer_email: asText(customer?.email),
      customer_phone: asText(customer?.phone),
      customer_company: asText(customer?.company_name),
      full_description: asText(row.job_description),
      quoted: row.quoted_amount ?? null,
      final: row.final_amount ?? null,
      estimated_minutes: row.estimated_duration_minutes ?? null,
      worker_notes: asText(row.completion_notes),
      declined_reason: brief.status === 'declined' ? asText(row.decline_reason) : null,
      history: happened,
      ...(report ? { report } : {}),
    });
  },
});

// ---------------------------------------------------------------------------

type Attention = {
  kind: 'declined' | 'not_completed' | 'no_worker' | 'ready_to_send' | 'late';
  job: JobBrief;
  why?: string | null;
};

const ATTENTION_LABEL: Record<Attention['kind'], { tag: string; tone: CardTone }> = {
  declined: { tag: 'Declined', tone: 'rose' },
  not_completed: { tag: 'Not completed', tone: 'amber' },
  no_worker: { tag: 'No worker', tone: 'amber' },
  ready_to_send: { tag: 'Ready to send', tone: 'sky' },
  late: { tag: 'Late', tone: 'rose' },
};

export const jobsNeedingAttention = defineTool({
  name: 'jobs_needing_attention',
  description:
    'What the office needs to deal with now: declined jobs (with why), jobs not completed in the last 14 days (with why), jobs with no worker, jobs ready to send out, and sent jobs now past their day.',
  product: 'pro',
  status: 'Checking what needs you',
  schema: z.object({ show: z.boolean().optional() }),
  async run(ctx, input) {
    const since = addDays(ctx.today, -14);
    const base = () => ctx.db.from('jobs').select(JOB_SELECT, { count: 'exact' }).eq('tenant_id', ctx.tenantId);
    const [declined, incomplete, noWorker, ready, late] = await Promise.all([
      base().eq('status', 'declined').order('scheduled_date', { ascending: true, nullsFirst: false }).limit(10),
      base().eq('status', 'incomplete').gte('scheduled_date', since).order('scheduled_date', { ascending: false }).limit(10),
      base().eq('status', 'pending').is('assigned_worker_id', null).is('network_dispatch_id', null).order('scheduled_date', { ascending: true, nullsFirst: false }).limit(10),
      base().eq('status', 'pending_send').order('scheduled_date', { ascending: true, nullsFirst: false }).limit(10),
      base().eq('status', 'assigned').lt('scheduled_date', ctx.today).order('scheduled_date', { ascending: true }).limit(10),
    ]);
    if ([declined, incomplete, noWorker, ready, late].some((r) => r.error)) return toolError('Could not read jobs.');

    const rows = (r: { data: unknown }) => ((r.data ?? []) as Raw[]).map((x) => briefJob(x, ctx.today));
    const declinedJobs = rows(declined);
    const incompleteJobs = rows(incomplete);
    // The reason a job wasn't completed lives in its report; fetch it for the few we will mention.
    const reasons = await Promise.all(
      incompleteJobs.slice(0, 5).map(async (j) => (await getJobOutcomeSummary(j.job_id)).summary?.reason ?? null),
    );
    const declineReason = new Map(((declined.data ?? []) as Raw[]).map((r) => [String(r.id), asText(r.decline_reason)]));

    const items: Attention[] = [
      ...declinedJobs.map((job) => ({ kind: 'declined' as const, job, why: declineReason.get(job.job_id) ?? null })),
      ...incompleteJobs.map((job, i) => ({ kind: 'not_completed' as const, job, why: reasons[i] ?? null })),
      ...rows(noWorker).map((job) => ({ kind: 'no_worker' as const, job })),
      ...rows(ready).map((job) => ({ kind: 'ready_to_send' as const, job })),
      ...rows(late).map((job) => ({ kind: 'late' as const, job })),
    ];

    const counts = {
      declined: declined.count ?? 0,
      not_completed_14_days: incomplete.count ?? 0,
      no_worker: noWorker.count ?? 0,
      ready_to_send: ready.count ?? 0,
      late: late.count ?? 0,
    };
    const cards: AssistantCard[] = [];
    if (input.show && items.length > 0) {
      cards.push({
        type: 'list',
        title: 'Needs you',
        items: items.slice(0, MAX_CARD_ROWS).map((a) =>
          jobListItem(a.job, {
            tag: ATTENTION_LABEL[a.kind].tag,
            tone: ATTENTION_LABEL[a.kind].tone,
            ...(a.why ? { subtitle: `${a.job.address} · ${a.why.length > 90 ? `${a.why.slice(0, 87).trimEnd()}…` : a.why}` } : {}),
          }),
        ),
        footer: items.length > MAX_CARD_ROWS ? `${items.length - MAX_CARD_ROWS} more not shown` : undefined,
      });
    }
    return ok(
      {
        counts,
        nothing_needs_attention: items.length === 0,
        declined: declinedJobs.map((j) => ({ ...j, why: declineReason.get(j.job_id) ?? null })),
        not_completed: incompleteJobs.map((j, i) => ({ ...j, why: reasons[i] ?? null })),
        no_worker: rows(noWorker),
        ready_to_send: rows(ready),
        late: rows(late),
      },
      { cards },
    );
  },
});

// ---------------------------------------------------------------------------

type WorkerRaw = Raw & { id: string; full_name: string };

async function loadWorkers(ctx: AssistantCtx): Promise<WorkerRaw[] | null> {
  const { data, error } = await ctx.db
    .from('workers')
    .select('id, full_name, phone, email, status, invite_status, skills, worker_type')
    .eq('primary_tenant_id', ctx.tenantId)
    .order('full_name')
    .limit(200);
  if (error) return null;
  return (data ?? []) as WorkerRaw[];
}

const INVITE_LABEL: Record<string, string> = { accepted: 'on the team', pending: 'invited, not accepted yet', deactivated: 'deactivated' };

export const listWorkers = defineTool({
  name: 'list_workers',
  description: 'The team: each worker with phone, status and whether they can be given jobs (they must have accepted their invite). Gives the worker_ids other tools need.',
  product: 'pro',
  status: 'Looking at your team',
  schema: z.object({ show: z.boolean().optional() }),
  async run(ctx, input) {
    const workers = await loadWorkers(ctx);
    if (!workers) return toolError('Could not read workers.');
    const list = workers.map((w) => ({
      worker_id: w.id,
      name: w.full_name,
      phone: asText(w.phone),
      status: asText(w.status),
      invite: INVITE_LABEL[String(w.invite_status)] ?? 'not set up to be given jobs',
      can_be_given_jobs: w.invite_status === 'accepted',
      skills: Array.isArray(w.skills) ? (w.skills as unknown[]).map(String).slice(0, 8) : [],
    }));
    const cards: AssistantCard[] = [];
    if (input.show && list.length > 0) {
      cards.push({
        type: 'list',
        title: 'Your team',
        people: true,
        items: workers.slice(0, MAX_CARD_ROWS).map((w, i) => ({
          id: w.id,
          title: w.full_name,
          subtitle: [asText(w.phone), list[i]!.invite].filter(Boolean).join(' · '),
          tone: w.invite_status === 'accepted' ? 'emerald' : 'slate',
          tag: w.invite_status === 'accepted' ? 'Active' : w.invite_status === 'pending' ? 'Invited' : 'Off',
          href: `/workers/${w.id}`,
        })),
      });
    }
    return ok({ count: list.length, workers: list }, { cards });
  },
});

export type DayLoad = { date: Ymd; jobs: number; done: number };

export const workerWorkload = defineTool({
  name: 'worker_workload',
  description: 'Who is free and who is busy: for each worker who can be given jobs, how many jobs they have on each day from `date` for `days` days (default today, 1 day), and the jobs themselves when it is a single day.',
  product: 'pro',
  status: 'Checking who is free',
  schema: z.object({
    date: ymd.optional().describe('First day. Default today.'),
    days: z.number().int().min(1).max(7).optional(),
    show: z.boolean().optional(),
  }),
  async run(ctx, input) {
    const start = input.date ?? ctx.today;
    const days = input.days ?? 1;
    const end = addDays(start, days - 1);
    const [workers, jobsRes] = await Promise.all([
      loadWorkers(ctx),
      ctx.db
        .from('jobs')
        .select('id, status, assigned_worker_id, scheduled_date, scheduled_time, reference_number, address')
        .eq('tenant_id', ctx.tenantId)
        .not('assigned_worker_id', 'is', null)
        .neq('status', 'cancelled')
        .gte('scheduled_date', start)
        .lte('scheduled_date', end)
        .limit(1000),
    ]);
    if (!workers || jobsRes.error) return toolError('Could not read the team or their jobs.');
    const jobs = (jobsRes.data ?? []) as Raw[];

    const team = workers
      .filter((w) => w.invite_status === 'accepted')
      .map((w) => {
        const mine = jobs.filter((j) => j.assigned_worker_id === w.id);
        const byDay: DayLoad[] = Array.from({ length: days }, (_, i) => {
          const date = addDays(start, i);
          const day = mine.filter((j) => ymdOf(j.scheduled_date) === date);
          return { date, jobs: day.length, done: day.filter((j) => j.status === 'completed').length };
        });
        const total = mine.length;
        return { w, mine, byDay, total };
      })
      .sort((a, b) => a.total - b.total || a.w.full_name.localeCompare(b.w.full_name));

    const result = team.map(({ w, mine, byDay, total }) => ({
      worker_id: w.id,
      name: w.full_name,
      jobs_in_period: total,
      free_days: byDay.filter((d) => d.jobs === 0).map((d) => friendlyDay(d.date, ctx.today)),
      by_day: Object.fromEntries(byDay.map((d) => [d.date, d.jobs])),
      ...(days === 1
        ? {
            jobs: mine
              .sort((a, b) => String(a.scheduled_time ?? '99').localeCompare(String(b.scheduled_time ?? '99')))
              .slice(0, 12)
              .map((j) => ({ reference: asText(j.reference_number), status: STATUS_LABEL[asStatus(j.status)], time: hhmm(j.scheduled_time), address: asText(j.address) })),
          }
        : {}),
    }));

    const cards: AssistantCard[] = [];
    if (input.show && team.length > 0) {
      const period = days === 1 ? friendlyDay(start, ctx.today) : `${dayLabel(start)} – ${dayLabel(end)}`;
      cards.push({
        type: 'list',
        title: `Who's free · ${period}`,
        people: true,
        items: team.slice(0, MAX_CARD_ROWS).map(({ w, byDay, total }) => {
          const free = byDay.filter((d) => d.jobs === 0).length;
          return {
            id: w.id,
            title: w.full_name,
            subtitle: days === 1 ? (total === 0 ? 'Nothing on' : `${total} job${total === 1 ? '' : 's'}`) : `${total} job${total === 1 ? '' : 's'} · free ${free} of ${days} days`,
            tone: total === 0 ? 'emerald' : 'sky',
            tag: total === 0 ? 'Free' : `${total} on`,
            href: `/workers/${w.id}`,
          };
        }),
      });
    }
    const day = days === 1 ? summariseDay(jobs.map((j) => ({ id: String(j.id), status: String(j.status), workerId: asText(j.assigned_worker_id), reference: asText(j.reference_number) }))) : null;
    return ok(
      { from: start, to: end, workers: result, ...(day ? { day_totals: { assigned_jobs: day.total, done: day.done, on_a_job_now: day.onJob } } : {}), note: result.length === 0 ? 'No worker has accepted their invite yet.' : undefined },
      { cards },
    );
  },
});

// ---------------------------------------------------------------------------

const OPEN_FOR_CUSTOMER: ProJobStatus[] = OPEN_STATUSES;

export const findJobCustomers = defineTool({
  name: 'find_job_customers',
  description: 'Find the customers jobs are done for (companies or people) by name, company or email, with how many jobs they have had and how many are open. Gives the customer_ids find_jobs takes.',
  product: 'pro',
  status: 'Looking through your customers',
  schema: z.object({ query: z.string().max(80).optional(), show: z.boolean().optional() }),
  async run(ctx, input) {
    let q = ctx.db
      .from('customers')
      .select('id, name, company_name, email, phone, total_jobs, last_job_date, is_active', { count: 'exact' })
      .eq('tenant_id', ctx.tenantId)
      .eq('is_active', true)
      .order('name')
      .limit(30);
    const term = input.query ? searchTerm(input.query) : '';
    if (term) {
      const like = `%${term}%`;
      q = q.or(`name.ilike.${like},company_name.ilike.${like},email.ilike.${like},contact_person.ilike.${like}`);
    }
    const { data, error, count } = await q;
    if (error) return toolError('Could not read customers.');
    const rows = (data ?? []) as Raw[];
    const ids = rows.map((r) => String(r.id));
    const open = new Map<string, number>();
    if (ids.length > 0) {
      const { data: openRows } = await ctx.db.from('jobs').select('customer_id').eq('tenant_id', ctx.tenantId).in('customer_id', ids).in('status', OPEN_FOR_CUSTOMER).limit(2000);
      for (const r of (openRows ?? []) as Raw[]) open.set(String(r.customer_id), (open.get(String(r.customer_id)) ?? 0) + 1);
    }
    const customers = rows.map((r) => ({
      customer_id: String(r.id),
      name: String(r.name),
      company: asText(r.company_name),
      email: asText(r.email),
      phone: asText(r.phone),
      jobs_in_total: typeof r.total_jobs === 'number' ? r.total_jobs : null,
      open_jobs: open.get(String(r.id)) ?? 0,
      last_job: ymdOf(r.last_job_date) ? friendlyDay(ymdOf(r.last_job_date)!, ctx.today) : null,
    }));
    const cards: AssistantCard[] = [];
    if (input.show && customers.length > 0) {
      cards.push({
        type: 'list',
        title: term ? `Customers matching "${term}"` : 'Customers',
        people: true,
        items: customers.slice(0, MAX_CARD_ROWS).map((c) => ({
          id: c.customer_id,
          title: c.name,
          subtitle: [c.company, c.jobs_in_total != null ? `${c.jobs_in_total} job${c.jobs_in_total === 1 ? '' : 's'}` : null, c.last_job ? `last ${c.last_job}` : null].filter(Boolean).join(' · '),
          tone: c.open_jobs > 0 ? 'sky' : 'slate',
          tag: c.open_jobs > 0 ? `${c.open_jobs} open` : undefined,
          href: `/customers/${c.customer_id}`,
        })),
        footer: (count ?? customers.length) > MAX_CARD_ROWS ? `${(count ?? customers.length) - MAX_CARD_ROWS} more not shown` : undefined,
      });
    }
    return ok({ total_matching: count ?? customers.length, customers }, { cards });
  },
});

// ---------------------------------------------------------------------------

export type PeriodTotals = {
  total: number;
  done: number;
  not_completed: number;
  declined: number;
  cancelled: number;
  open: number;
};

/** Counts by outcome. Pure; exported for tests. */
export function totalsFor(rows: Array<{ status: string }>): PeriodTotals {
  const t: PeriodTotals = { total: 0, done: 0, not_completed: 0, declined: 0, cancelled: 0, open: 0 };
  for (const r of rows) {
    if (r.status === 'cancelled') {
      t.cancelled += 1;
      continue;
    }
    t.total += 1;
    if (r.status === 'completed') t.done += 1;
    else if (r.status === 'incomplete') t.not_completed += 1;
    else if (r.status === 'declined') t.declined += 1;
    else t.open += 1;
  }
  return t;
}

/** Monday of the week a day falls in. */
function weekStart(day: Ymd): Ymd {
  const wd = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -wd);
}

export const jobNumbers = defineTool({
  name: 'job_numbers',
  description:
    'Counts of jobs by outcome (done, not completed, declined, still open) for jobs scheduled between two dates (default the last 30 days up to today, max 92 days), split by worker. show:true adds key figures and a chart of jobs per day (or per week for longer periods).',
  product: 'pro',
  status: 'Counting your jobs',
  schema: z.object({ from: ymd.optional(), to: ymd.optional(), show: z.boolean().optional() }),
  async run(ctx, input) {
    const to = input.to ?? ctx.today;
    const from = input.from ?? addDays(to, -29);
    if (diffDays(from, to) < 0) return toolError('`from` is after `to`.');
    if (diffDays(from, to) > 91) return toolError('Pick a period of 92 days or less.');
    let rows: Raw[];
    try {
      rows = await readAllPages(
        (a, b) =>
          ctx.db
            .from('jobs')
            .select('id, status, assigned_worker_id, scheduled_date, worker:workers!assigned_worker_id(full_name)')
            .eq('tenant_id', ctx.tenantId)
            .gte('scheduled_date', from)
            .lte('scheduled_date', to)
            .order('id')
            .range(a, b),
        'jobs',
      );
    } catch {
      return toolError('Could not count jobs.');
    }
    const totals = totalsFor(rows.map((r) => ({ status: String(r.status) })));
    const finished = totals.done + totals.not_completed;
    const byWorker = new Map<string, { name: string; rows: Array<{ status: string }> }>();
    for (const r of rows) {
      const name = asText(one(r.worker)?.full_name);
      if (!name) continue;
      const entry = byWorker.get(name) ?? { name, rows: [] };
      entry.rows.push({ status: String(r.status) });
      byWorker.set(name, entry);
    }
    const workers = [...byWorker.values()]
      .map((w) => ({ name: w.name, ...totalsFor(w.rows) }))
      .sort((a, b) => b.done - a.done)
      .slice(0, 15);

    const cards: AssistantCard[] = [];
    if (input.show && totals.total > 0) {
      cards.push({
        type: 'stats',
        title: `${dayLabel(from)} – ${dayLabel(to)}`,
        items: [
          { label: 'Jobs', value: String(totals.total), tone: 'sky' },
          { label: 'Done', value: String(totals.done), tone: 'emerald' },
          { label: 'Not completed', value: String(totals.not_completed), tone: totals.not_completed > 0 ? 'amber' : 'slate' },
          { label: 'Declined', value: String(totals.declined), tone: totals.declined > 0 ? 'rose' : 'slate' },
        ],
      });
      const weekly = diffDays(from, to) > 31;
      const buckets = new Map<string, { label: string; done: number; not_completed: number; other: number }>();
      for (let d = from; diffDays(d, to) >= 0; d = addDays(d, 1)) {
        const key = weekly ? weekStart(d) : d;
        if (!buckets.has(key)) buckets.set(key, { label: weekly ? `w/c ${dayLabel(key < from ? from : key)}` : dayLabel(d), done: 0, not_completed: 0, other: 0 });
      }
      for (const r of rows) {
        const day = ymdOf(r.scheduled_date);
        if (!day || r.status === 'cancelled') continue;
        const b = buckets.get(weekly ? weekStart(day) : day);
        if (!b) continue;
        if (r.status === 'completed') b.done += 1;
        else if (r.status === 'incomplete' || r.status === 'declined') b.not_completed += 1;
        else b.other += 1;
      }
      cards.push({
        type: 'bar_chart',
        title: weekly ? 'Jobs per week' : 'Jobs per day',
        series: [
          { key: 'done', label: 'Done', tone: 'emerald' },
          { key: 'not_completed', label: 'Not completed / declined', tone: 'amber' },
          { key: 'other', label: 'Still to do', tone: 'sky' },
        ],
        points: [...buckets.values()].map((b) => ({ label: b.label, values: { done: b.done, not_completed: b.not_completed, other: b.other } })),
      });
    }
    return ok(
      {
        from,
        to,
        ...totals,
        completion_rate_percent: finished > 0 ? Math.round((totals.done / finished) * 100) : null,
        by_worker: workers,
        unassigned_in_period: rows.filter((r) => !r.assigned_worker_id && r.status !== 'cancelled').length,
      },
      { cards },
    );
  },
});

export const READ_PRO_TOOLS = [findJobs, getJob, jobsNeedingAttention, listWorkers, workerWorkload, findJobCustomers, jobNumbers];
