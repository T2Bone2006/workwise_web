import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { customerEmailFrom } from '@/lib/emails/visit-done';
import { buildPlainCustomerEmail } from '@/lib/emails/plain-customer';
import {
  getTenantMessagingContext,
  type TenantMessagingContext,
} from '@/lib/messaging/brand';
import { FALLBACK_SUBJECTS } from '@/lib/messaging/email-fallback';
import {
  sendCustomerMessage,
  type SendOutcome,
} from '@/lib/messaging/send';
import {
  afterAllSms,
  dayMovedSms,
  daySkippedSms,
} from '@/lib/messaging/templates';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd, type Ymd } from '@/lib/rounds/dates';
import { groupHouseStops, type HouseFields } from '@/lib/rounds/house-stops';
import { getVisitChange } from '@/lib/rounds/visit-changes';
import { createAdminClient } from '@/lib/supabase/admin';

export type NoticeCounts = {
  stops: number;
  texted: number;
  held: number;
  emailed: number;
  skipped: number;
  failed: number;
};

type NoticeJob = HouseFields & {
  service_agreement_id: string | null;
  route_position: number | null;
  scheduled_time: string | null;
};

type ClaimedChange = {
  kind: string;
  fromDate: string | null;
  toDate: string | null;
  jobIds: string[];
  dates: Map<string, string | null>;
};

const UNDONE_BEFORE_SENDING = 'undone before sending';

function emptyCounts(): NoticeCounts {
  return { stops: 0, texted: 0, held: 0, emailed: 0, skipped: 0, failed: 0 };
}

function logFailure(scope: string, err: unknown): void {
  console.error(`[${scope}]`, err instanceof Error ? err.message : 'failed');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((row): row is Record<string, unknown> => asRecord(row) != null);
  }
  const row = asRecord(value);
  return row ? [row] : [];
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    const id = asId(item);
    if (id) ids.push(id);
  }
  return ids;
}

function asYmd(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const sliced = value.slice(0, 10);
  return isValidYmd(sliced) ? sliced : null;
}

function dayLabel(ymd: string | null): string | null {
  if (!ymd) return null;
  try {
    return formatVisitDay(ymd);
  } catch {
    return null;
  }
}

function snapshotDates(before: unknown): Map<string, string | null> {
  const dates = new Map<string, string | null>();
  let raw = before;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return dates;
    }
  }
  for (const item of asRows(raw)) {
    const id = asId(item.job_id);
    if (id) dates.set(id, asYmd(item.scheduled_date));
  }
  return dates;
}

function claimedChange(data: unknown): ClaimedChange | null {
  const row = asRecord(data);
  if (!row) return null;
  const kind = asId(row.kind);
  const jobIds = asIdList(row.job_ids);
  if (!kind || jobIds.length === 0) return null;
  return {
    kind,
    fromDate: asYmd(row.from_date),
    toDate: asYmd(row.to_date),
    jobIds,
    dates: snapshotDates(row.before),
  };
}

function noticeJob(raw: unknown): NoticeJob | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asId(row.id);
  if (!id) return null;
  const position = row.route_position;
  return {
    id,
    customer_id: asId(row.customer_id),
    address: typeof row.address === 'string' ? row.address : '',
    postcode: typeof row.postcode === 'string' ? row.postcode : '',
    service_agreement_id: asId(row.service_agreement_id),
    route_position:
      typeof position === 'number' && Number.isFinite(position) ? position : null,
    scheduled_time: asId(row.scheduled_time),
  };
}

function inJobOrder(jobIds: string[], jobs: NoticeJob[]): NoticeJob[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const ordered: NoticeJob[] = [];
  for (const id of jobIds) {
    const job = byId.get(id);
    if (job) ordered.push(job);
  }
  return ordered;
}

function firstSortedId(ids: string[]): string | null {
  const sorted = [...ids].sort();
  return sorted[0] ?? null;
}

function isMoveKind(kind: string): boolean {
  return kind === 'move_remaining' || kind === 'reschedule';
}

function isSkipKind(kind: string): boolean {
  return kind === 'skip' || kind === 'skip_remaining';
}

function addOutcome(counts: NoticeCounts, outcome: SendOutcome): void {
  switch (outcome.outcome) {
    case 'text_sent':
      counts.texted += 1;
      return;
    case 'text_held':
      counts.held += 1;
      return;
    case 'email_sent':
      counts.emailed += 1;
      return;
    case 'duplicate':
    case 'skipped':
      counts.skipped += 1;
      return;
    case 'failed':
      counts.failed += 1;
      return;
    default: {
      const unreachable: never = outcome;
      void unreachable;
      counts.failed += 1;
    }
  }
}

function intersects(jobIds: string[], restored: ReadonlySet<string>): boolean {
  return jobIds.some((id) => restored.has(id));
}

function wasTold(status: string): boolean {
  return status === 'sent' || status === 'delivered';
}

async function loadJobs(
  admin: SupabaseClient,
  tenantId: string,
  jobIds: string[],
): Promise<NoticeJob[] | null> {
  if (jobIds.length === 0) return [];
  const { data, error } = await admin
    .from('jobs')
    .select(
      'id, customer_id, address, postcode, service_agreement_id, route_position, scheduled_time',
    )
    .eq('tenant_id', tenantId)
    .in('id', jobIds);
  if (error) {
    console.error('[notifyVisitChange] jobs', error.message);
    return null;
  }
  const jobs: NoticeJob[] = [];
  for (const raw of asRows(data)) {
    const job = noticeJob(raw);
    if (job) jobs.push(job);
  }
  return inJobOrder(jobIds, jobs);
}

async function nextAssignedDay(
  admin: SupabaseClient,
  tenantId: string,
  stop: NoticeJob[],
  afterYmd: string,
): Promise<string | null> {
  const agreementIds = [
    ...new Set(
      stop
        .map((job) => job.service_agreement_id)
        .filter((id): id is string => id != null),
    ),
  ];
  if (agreementIds.length === 0) return null;
  const exclude = new Set(stop.map((job) => job.id));
  const { data, error } = await admin
    .from('jobs')
    .select('id, scheduled_date')
    .eq('tenant_id', tenantId)
    .eq('status', 'assigned')
    .in('service_agreement_id', agreementIds)
    .gt('scheduled_date', afterYmd)
    .order('scheduled_date', { ascending: true })
    .limit(8);
  if (error) {
    console.error('[notifyVisitChange] next visit', error.message);
    return null;
  }
  const dates: string[] = [];
  for (const raw of asRows(data)) {
    const id = asId(raw.id);
    const ymd = asYmd(raw.scheduled_date);
    if (!id || !ymd || exclude.has(id)) continue;
    dates.push(ymd);
  }
  dates.sort();
  return dayLabel(dates[0] ?? null);
}

async function customerEmailAddress(
  admin: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('customers')
    .select('email')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return asId(asRecord(data)?.email);
}

async function sendPlainChangeEmail(p: {
  to: string;
  ctx: TenantMessagingContext;
  text: string;
}): Promise<{ sent: boolean; error?: string }> {
  const built = buildPlainCustomerEmail({
    businessName: p.ctx.businessName,
    logoUrl: p.ctx.logoUrl,
    subject: FALLBACK_SUBJECTS.visit_change(p.ctx.businessName),
    text: p.text,
  });
  try {
    const { resend } = await import('@/lib/resend');
    const { error } = await resend.emails.send({
      from: customerEmailFrom(p.ctx.businessName),
      to: p.to,
      subject: built.subject,
      html: built.html,
      text: built.text,
      ...(p.ctx.replyToEmail ? { replyTo: p.ctx.replyToEmail } : {}),
    });
    if (error) return { sent: false, error: error.message };
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'Email send failed' };
  }
}

async function deliverStop(
  admin: SupabaseClient,
  counts: NoticeCounts,
  p: {
    tenantId: string;
    customerId: string;
    changeId: string;
    jobIds: string[];
    body: string;
    dedupeKey: string;
    ctx: TenantMessagingContext;
    now: Date;
  },
): Promise<void> {
  counts.stops += 1;
  try {
    const outcome = await sendCustomerMessage({
      tenantId: p.tenantId,
      customerId: p.customerId,
      kind: 'visit_change',
      dedupeKey: p.dedupeKey,
      text: () => p.body,
      email: async () => {
        const to = await customerEmailAddress(admin, p.tenantId, p.customerId);
        if (!to) return { sent: false, error: 'No email' };
        return sendPlainChangeEmail({ to, ctx: p.ctx, text: p.body });
      },
      jobIds: p.jobIds,
      visitChangeId: p.changeId,
      bindThread: true,
      now: p.now,
    });
    addOutcome(counts, outcome);
  } catch (err) {
    logFailure('notifyVisitChange', err);
    counts.failed += 1;
  }
}

/** A swap moves jobs both ways, so one house with a job on each day is two stops (each has its own old day). */
function splitByOldDay(groups: NoticeJob[][], dates: Map<string, string | null>): NoticeJob[][] {
  const split: NoticeJob[][] = [];
  for (const group of groups) {
    const byDay = new Map<string, NoticeJob[]>();
    for (const job of group) {
      const day = dates.get(job.id) ?? '';
      const list = byDay.get(day);
      if (list) list.push(job);
      else byDay.set(day, [job]);
    }
    split.push(...byDay.values());
  }
  return split;
}

async function bodyForStop(
  admin: SupabaseClient,
  tenantId: string,
  change: ClaimedChange,
  stop: NoticeJob[],
  brand: { businessName: string; contactPhone: string | null },
): Promise<string | null> {
  const first = stop[0];
  const fromYmd = (first ? change.dates.get(first.id) : null) || change.fromDate;
  const fromDay = dayLabel(fromYmd);
  if (!fromDay || !fromYmd) return null;
  if (isMoveKind(change.kind)) {
    const toDay = dayLabel(change.toDate);
    if (!toDay) return null;
    return dayMovedSms({ brand, fromDay, toDay });
  }
  if (change.kind === 'swap_days') {
    // Each stop goes to the OTHER day of the swap.
    const toDay = dayLabel(fromYmd === change.fromDate ? change.toDate : change.fromDate);
    if (!toDay) return null;
    return dayMovedSms({ brand, fromDay, toDay });
  }
  if (isSkipKind(change.kind)) {
    const nextDay = await nextAssignedDay(admin, tenantId, stop, fromYmd);
    return daySkippedSms({ brand, day: fromDay, nextDay });
  }
  return null;
}

/** Tell customers about a change. Claims visit_changes.notified_at first (atomic), so it runs once per change. */
export async function notifyVisitChange(p: {
  tenantId: string;
  changeId: string;
  now?: Date;
}): Promise<NoticeCounts> {
  const counts = emptyCounts();
  try {
    const now = p.now ?? new Date();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('visit_changes')
      .update({ notified_at: now.toISOString() })
      .eq('id', p.changeId)
      .eq('tenant_id', p.tenantId)
      .eq('notify_customers', true)
      .is('notified_at', null)
      .select('*')
      .maybeSingle();
    if (error) {
      console.error('[notifyVisitChange] claim', error.message);
      return counts;
    }
    const change = claimedChange(data);
    if (!change) return counts;

    const jobs = await loadJobs(admin, p.tenantId, change.jobIds);
    if (!jobs) return counts;
    const groups =
      change.kind === 'swap_days'
        ? splitByOldDay(groupHouseStops(jobs), change.dates)
        : groupHouseStops(jobs);
    const ctx = await getTenantMessagingContext(admin, p.tenantId);
    const brand = ctx
      ? { businessName: ctx.businessName, contactPhone: ctx.contactPhone }
      : null;

    for (const stop of groups) {
      const customerId = stop[0]?.customer_id ?? null;
      if (!customerId) {
        counts.skipped += 1;
        continue;
      }
      const jobIds = stop.map((job) => job.id);
      const dedupeId = firstSortedId(jobIds);
      if (!ctx || !brand || !dedupeId) {
        counts.stops += 1;
        counts.failed += 1;
        continue;
      }
      const body = await bodyForStop(admin, p.tenantId, change, stop, brand);
      if (!body) {
        counts.stops += 1;
        counts.failed += 1;
        continue;
      }
      await deliverStop(admin, counts, {
        tenantId: p.tenantId,
        customerId,
        changeId: p.changeId,
        jobIds,
        body,
        dedupeKey: `change:${p.changeId}:${dedupeId}`,
        ctx,
        now,
      });
    }
  } catch (err) {
    logFailure('notifyVisitChange', err);
  }
  return counts;
}

/**
 * "Tell them" for a move that has already happened. Sets notify_customers
 * (with the trader's own client, so RLS keeps it to their business) only while
 * the change is not undone and not yet told, then notifyVisitChange claims
 * notified_at and sends. Pressing twice sends once.
 */
export async function requestChangeNotice(
  supabase: SupabaseClient,
  p: { tenantId: string; changeId: string; today: Ymd },
): Promise<
  | { success: true; alreadyTold: boolean; notified: NoticeCounts }
  | { success: false; error: string }
> {
  const change = await getVisitChange(supabase, p.tenantId, p.changeId);
  if (!change) return { success: false, error: 'Change not found' };
  if (change.undoneAt) return { success: false, error: 'This change was undone.' };
  if (change.notifiedAt) {
    return { success: true, alreadyTold: true, notified: emptyCounts() };
  }
  if (change.kind !== 'reschedule' && change.kind !== 'move_remaining' && change.kind !== 'swap_days') {
    return { success: false, error: 'Only moves can be told.' };
  }
  const tooLate =
    change.kind === 'swap_days'
      ? (change.fromDate ?? '') < p.today && (change.toDate ?? '') < p.today
      : (change.toDate ?? '') < p.today;
  if (tooLate) {
    return { success: false, error: 'Too late to tell them — that day has passed.' };
  }

  const { data, error } = await supabase
    .from('visit_changes')
    .update({ notify_customers: true })
    .eq('id', p.changeId)
    .eq('tenant_id', p.tenantId)
    .is('undone_at', null)
    .is('notified_at', null)
    .select('id');
  if (error) {
    console.error('[requestChangeNotice] claim', error.message);
    return { success: false, error: 'Could not tell them. Try again.' };
  }
  if (!Array.isArray(data) || data.length === 0) {
    const again = await getVisitChange(supabase, p.tenantId, p.changeId);
    if (again?.undoneAt) return { success: false, error: 'This change was undone.' };
    if (again?.notifiedAt) {
      return { success: true, alreadyTold: true, notified: emptyCounts() };
    }
    return { success: false, error: 'Could not tell them. Try again.' };
  }

  const notified = await notifyVisitChange({ tenantId: p.tenantId, changeId: p.changeId });
  return { success: true, alreadyTold: false, notified };
}

type ToldMessage = {
  id: string;
  customerId: string;
  jobIds: string[];
  segments: number | null;
  billedFrom: string | null;
  billedMonth: string | null;
  status: string;
};

function toldMessage(raw: unknown): ToldMessage | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asId(row.id);
  const customerId = asId(row.customer_id);
  const status = asId(row.status);
  if (!id || !customerId || !status) return null;
  const segments = row.segments;
  const billedFrom = row.billed_from;
  return {
    id,
    customerId,
    jobIds: asIdList(row.job_ids),
    segments:
      typeof segments === 'number' && Number.isInteger(segments) && segments >= 1
        ? segments
        : null,
    billedFrom: billedFrom === 'allowance' || billedFrom === 'pack' ? billedFrom : null,
    billedMonth: asId(row.billed_month),
    status,
  };
}

async function cancelHeld(
  admin: SupabaseClient,
  tenantId: string,
  message: ToldMessage,
  counts: NoticeCounts,
): Promise<void> {
  const { data, error } = await admin
    .from('messages')
    .update({ status: 'skipped', error: UNDONE_BEFORE_SENDING })
    .eq('id', message.id)
    .eq('tenant_id', tenantId)
    .eq('status', 'held')
    .select('id');
  if (error) {
    console.error('[notifyVisitChangeUndone] hold cancel', error.message);
    counts.failed += 1;
    return;
  }
  if (asRows(data).length === 0) return;
  counts.skipped += 1;
  if (message.segments == null || message.billedFrom == null || message.billedMonth == null) {
    console.error('[notifyVisitChangeUndone] held row missing credit fields', message.id);
    return;
  }
  const { error: refundError } = await admin.rpc('refund_text_credits', {
    p_tenant_id: tenantId,
    p_segments: message.segments,
    p_from: message.billedFrom,
    p_month: message.billedMonth,
  });
  if (refundError) {
    console.error('[notifyVisitChangeUndone] refund', refundError.message);
  }
}

/** After an undo: tell only customers who were told about the change; cancel texts still held. */
export async function notifyVisitChangeUndone(p: {
  tenantId: string;
  changeId: string;
  restoredJobIds: string[];
  now?: Date;
}): Promise<NoticeCounts> {
  const counts = emptyCounts();
  try {
    const now = p.now ?? new Date();
    const admin = createAdminClient();
    const restored = new Set(p.restoredJobIds);

    const { data: changeRow, error: changeError } = await admin
      .from('visit_changes')
      .select('id, from_date, before, job_ids')
      .eq('id', p.changeId)
      .eq('tenant_id', p.tenantId)
      .maybeSingle();
    if (changeError) {
      console.error('[notifyVisitChangeUndone] change', changeError.message);
      return counts;
    }
    const change = asRecord(changeRow);
    const dates = snapshotDates(change?.before);
    const fromDate = asYmd(change?.from_date);
    const changeJobIds = asIdList(change?.job_ids);

    const { data: messageRows, error: messageError } = await admin
      .from('messages')
      .select('id, customer_id, channel, status, job_ids, segments, billed_from, billed_month')
      .eq('tenant_id', p.tenantId)
      .eq('visit_change_id', p.changeId)
      // A reply ack ("no problem, we'll come on Mon") told them too.
      .in('kind', ['visit_change', 'reply_ack']);
    if (messageError) {
      console.error('[notifyVisitChangeUndone] messages', messageError.message);
      return counts;
    }

    const told: ToldMessage[] = [];
    for (const raw of asRows(messageRows)) {
      const message = toldMessage(raw);
      if (!message || !intersects(message.jobIds, restored)) continue;
      if (message.status === 'held') {
        await cancelHeld(admin, p.tenantId, message, counts);
        continue;
      }
      if (wasTold(message.status)) told.push(message);
    }

    const toldJobIds = new Set<string>();
    for (const message of told) {
      for (const id of message.jobIds) {
        if (restored.has(id)) toldJobIds.add(id);
      }
    }
    const orderedIds = changeJobIds.filter((id) => toldJobIds.has(id));
    for (const id of toldJobIds) {
      if (!orderedIds.includes(id)) orderedIds.push(id);
    }

    const loaded = await loadJobs(admin, p.tenantId, orderedIds);
    const jobs = loaded ?? [];
    const groups = groupHouseStops(jobs);
    const covered = new Set(groups.flat().map((job) => job.id));
    for (const message of told) {
      const missing = message.jobIds.filter((id) => restored.has(id) && !covered.has(id));
      if (missing.length === 0) continue;
      groups.push([
        {
          id: missing[0]!,
          customer_id: message.customerId,
          address: message.customerId,
          postcode: '',
          service_agreement_id: null,
          route_position: null,
          scheduled_time: null,
        },
      ]);
      for (const id of missing) covered.add(id);
    }

    const ctx =
      groups.length > 0 ? await getTenantMessagingContext(admin, p.tenantId) : null;
    const brand = ctx
      ? { businessName: ctx.businessName, contactPhone: ctx.contactPhone }
      : null;

    for (const stop of groups) {
      const customerId = stop[0]?.customer_id ?? null;
      const jobIds = stop.map((job) => job.id).filter((id) => restored.has(id));
      const dedupeId = firstSortedId(jobIds);
      if (!customerId || jobIds.length === 0 || !dedupeId) {
        counts.skipped += 1;
        continue;
      }
      const fromYmd = (stop[0] ? dates.get(stop[0].id) : null) || fromDate;
      const day = dayLabel(fromYmd);
      if (!ctx || !brand || !day) {
        counts.stops += 1;
        counts.failed += 1;
        continue;
      }
      await deliverStop(admin, counts, {
        tenantId: p.tenantId,
        customerId,
        changeId: p.changeId,
        jobIds,
        body: afterAllSms({ brand, day }),
        dedupeKey: `change_undo:${p.changeId}:${dedupeId}`,
        ctx,
        now,
      });
    }

    const { error: stampError } = await admin
      .from('visit_changes')
      .update({ undo_notified_at: now.toISOString() })
      .eq('id', p.changeId)
      .eq('tenant_id', p.tenantId);
    if (stampError) {
      console.error('[notifyVisitChangeUndone] undo_notified_at', stampError.message);
    }
  } catch (err) {
    logFailure('notifyVisitChangeUndone', err);
  }
  return counts;
}
