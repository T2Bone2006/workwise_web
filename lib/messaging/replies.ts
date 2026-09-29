import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { customerEmailFrom } from '@/lib/emails/visit-done';
import { buildPlainCustomerEmail } from '@/lib/emails/plain-customer';
import { getTenantMessagingContext, type TenantMessagingContext } from '@/lib/messaging/brand';
import { FALLBACK_SUBJECTS } from '@/lib/messaging/email-fallback';
import { pushReplyToOwner } from '@/lib/messaging/owner-push';
import { sendCustomerMessage, type SendOutcome } from '@/lib/messaging/send';
import { replyMoveAckSms, replySkipAckSms, type SmsBrand } from '@/lib/messaging/templates';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { rescheduleStopWithLog, skipStopWithLog } from '@/lib/rounds/visit-changes';
import { RESCHEDULE_STATUSES, type Actor } from '@/lib/rounds/visit-transitions';
import { createAdminClient } from '@/lib/supabase/admin';

export async function applyReplyOutcome(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    threadId: string;
    customerId: string;
    messageId: string;
    intent: 'said_no' | 'asked_move' | 'question';
    proposedDate: string | null;
    boundJobIds: string[];
    body: string;
  },
): Promise<void> {
  try {
    if (p.boundJobIds.length > 0) {
      const status =
        p.intent === 'said_no' ? 'declined' : p.intent === 'asked_move' ? 'rescheduled' : 'replied';
      const { error } = await admin
        .from('jobs')
        .update({
          customer_reply_at: new Date().toISOString(),
          customer_confirmation_status: status,
          customer_requested_date: p.intent === 'asked_move' ? p.proposedDate : null,
        })
        .eq('tenant_id', p.tenantId)
        .in('id', p.boundJobIds);
      if (error) console.error('[applyReplyOutcome] labels', error.message);
    }

    const jobId = p.boundJobIds[0] ?? null;
    await pushReplyToOwner(admin, p.tenantId, {
      customerName: await customerName(admin, p.tenantId, p.customerId),
      intent: p.intent,
      visitDate: jobId ? await scheduledDate(admin, p.tenantId, jobId) : null,
      requestedDate: p.intent === 'asked_move' ? p.proposedDate : null,
      body: p.body,
      threadId: p.threadId,
      jobId,
    });
  } catch (err) {
    console.error('[applyReplyOutcome]', err instanceof Error ? err.message : 'failed');
  }
}

export type ReplyAction = 'skip' | 'keep' | 'move' | 'dismiss';

export async function actOnReplyCore(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    actor: Actor;
    threadId: string;
    action: ReplyAction;
    toDate?: string | null;
    letThemKnow?: boolean;
  },
): Promise<
  | { success: true; changeId: string | null; acknowledged: boolean }
  | { success: false; error: string; code?: 'no_visit' | 'needs_date' | 'nothing_to_do' }
> {
  const admin = createAdminClient();
  const thread = await loadThread(admin, p.tenantId, p.threadId);
  if (!thread) return { success: false, error: 'Conversation not found' };

  const message = await newestOpenReply(admin, p.tenantId, p.threadId);
  if (!message) {
    if (p.action === 'dismiss' && thread.status === 'needs_attention') {
      const cleared = await clearReview(admin, p.tenantId, p.threadId);
      if (!cleared.ok) return { success: false, error: cleared.error };
      return { success: true, changeId: null, acknowledged: false };
    }
    if (thread.status !== 'needs_attention') {
      return { success: false, error: 'Nothing to do', code: 'nothing_to_do' };
    }
  }

  let jobs = await openJobs(admin, p.tenantId, message?.jobIds ?? []);
  if (jobs.length === 0 && thread.status === 'needs_attention' && p.action !== 'dismiss') {
    jobs = await customerNextStop(admin, p.tenantId, thread.customerId);
  }
  if (p.action !== 'dismiss' && jobs.length === 0) {
    return { success: false, error: 'No visit to change', code: 'no_visit' };
  }

  const originalDate = jobs[0]?.scheduledDate ?? null;
  let changeId: string | null = null;
  let moveDate: Ymd | null = null;

  if (p.action === 'skip') {
    const result = await skipStopWithLog(supabase, {
      tenantId: p.tenantId,
      jobIds: jobs.map((job) => job.id),
      reason: 'customer_declined',
      actor: p.actor,
      notifyCustomers: false,
    });
    if (!result.success) return { success: false, error: result.error };
    changeId = result.changeId;
  } else if (p.action === 'move') {
    moveDate = asYmd(p.toDate) ?? asYmd(message?.requestedDate);
    if (!moveDate) return { success: false, error: 'Pick a date', code: 'needs_date' };
    const result = await rescheduleStopWithLog(supabase, {
      tenantId: p.tenantId,
      jobIds: jobs.map((job) => job.id),
      scheduledDate: moveDate,
      actor: p.actor,
      notifyCustomers: false,
    });
    if (!result.success) return { success: false, error: result.error };
    changeId = result.changeId;
  } else if (p.action === 'keep') {
    const { error } = await supabase
      .from('jobs')
      .update({
        customer_confirmation_status: null,
        customer_requested_date: null,
        customer_reply_at: null,
      })
      .eq('tenant_id', p.tenantId)
      .in(
        'id',
        jobs.map((job) => job.id),
      );
    if (error) return { success: false, error: error.message };
  }

  const cleared = await clearReview(admin, p.tenantId, p.threadId, handledAction(p.action));
  if (!cleared.ok) return { success: false, error: cleared.error };

  let acknowledged = false;
  if (message && (p.action === 'skip' || p.action === 'move') && p.letThemKnow === true) {
    try {
      acknowledged = await sendReplyAck(admin, {
        tenantId: p.tenantId,
        customerId: thread.customerId,
        messageId: message.id,
        action: p.action,
        jobIds: jobs.map((job) => job.id),
        changeId,
        originalDate,
        moveDate,
      });
    } catch (err) {
      console.error('[actOnReplyCore] ack', err instanceof Error ? err.message : 'failed');
    }
  }

  return { success: true, changeId, acknowledged };
}

/** Opening a conversation: unread → 0 (does not clear needs_attention). */
export async function markThreadRead(
  admin: SupabaseClient,
  tenantId: string,
  threadId: string,
): Promise<void> {
  const { error } = await admin
    .from('message_threads')
    .update({ unread_count: 0 })
    .eq('id', threadId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(error.message);
}

function handledAction(action: ReplyAction): 'skipped' | 'moved' | 'kept' | 'dismissed' {
  if (action === 'skip') return 'skipped';
  if (action === 'move') return 'moved';
  if (action === 'keep') return 'kept';
  return 'dismissed';
}

function asYmd(value: unknown): Ymd | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const sliced = value.slice(0, 10);
  return isValidYmd(sliced) ? sliced : null;
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id !== '');
}

async function customerName(
  admin: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<string> {
  const { data, error } = await admin
    .from('customers')
    .select('name')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return 'Customer';
  const name = (data as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : 'Customer';
}

async function scheduledDate(
  admin: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('jobs')
    .select('scheduled_date')
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return asYmd((data as { scheduled_date?: unknown }).scheduled_date);
}

async function loadThread(
  admin: SupabaseClient,
  tenantId: string,
  threadId: string,
): Promise<{ customerId: string; status: string } | null> {
  const { data, error } = await admin
    .from('message_threads')
    .select('id, customer_id, status')
    .eq('id', threadId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { customer_id?: unknown; status?: unknown };
  const customerId = asId(row.customer_id);
  const status = typeof row.status === 'string' ? row.status : '';
  return customerId ? { customerId, status } : null;
}

async function clearReview(
  admin: SupabaseClient,
  tenantId: string,
  threadId: string,
  action: 'skipped' | 'moved' | 'kept' | 'dismissed' = 'dismissed',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const handled = await admin
    .from('messages')
    .update({ handled_at: now, handled_action: action })
    .eq('tenant_id', tenantId)
    .eq('thread_id', threadId)
    .eq('direction', 'inbound')
    .is('handled_at', null);
  if (handled.error) return { ok: false, error: handled.error.message };

  const threadUpdate = await admin
    .from('message_threads')
    .update({
      status: 'open',
      needs_attention_reason: null,
      unread_count: 0,
    })
    .eq('id', threadId)
    .eq('tenant_id', tenantId);
  if (threadUpdate.error) return { ok: false, error: threadUpdate.error.message };
  return { ok: true };
}

type OpenReply = { id: string; jobIds: string[]; requestedDate: string | null };

async function newestOpenReply(
  admin: SupabaseClient,
  tenantId: string,
  threadId: string,
): Promise<OpenReply | null> {
  const { data, error } = await admin
    .from('messages')
    .select('id, job_ids, requested_date, created_at')
    .eq('tenant_id', tenantId)
    .eq('thread_id', threadId)
    .eq('direction', 'inbound')
    .is('handled_at', null)
    .in('classification', ['said_no', 'asked_move', 'question'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    const anyInbound = await admin
      .from('messages')
      .select('id, job_ids, requested_date, created_at')
      .eq('tenant_id', tenantId)
      .eq('thread_id', threadId)
      .eq('direction', 'inbound')
      .is('handled_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (anyInbound.error || !anyInbound.data) return null;
    return mapOpenReply(anyInbound.data);
  }
  return mapOpenReply(data);
}

function mapOpenReply(data: unknown): OpenReply | null {
  const row = data as { id?: unknown; job_ids?: unknown; requested_date?: unknown };
  const id = asId(row.id);
  if (!id) return null;
  return {
    id,
    jobIds: asIdList(row.job_ids),
    requestedDate: asYmd(row.requested_date),
  };
}

async function customerNextStop(
  admin: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<{ id: string; scheduledDate: string | null }[]> {
  const today = todayInLondon();
  const { data, error } = await admin
    .from('jobs')
    .select('id, scheduled_date')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .in('status', [...RESCHEDULE_STATUSES])
    .gte('scheduled_date', today)
    .order('scheduled_date', { ascending: true });
  if (error || !data) return [];
  const rows = data as { id?: unknown; scheduled_date?: unknown }[];
  const firstDate = asYmd(rows[0]?.scheduled_date);
  if (!firstDate) return [];
  const jobs: { id: string; scheduledDate: string | null }[] = [];
  for (const row of rows) {
    if (asYmd(row.scheduled_date) !== firstDate) continue;
    const id = asId(row.id);
    if (id) jobs.push({ id, scheduledDate: firstDate });
  }
  return jobs;
}

async function openJobs(
  admin: SupabaseClient,
  tenantId: string,
  jobIds: string[],
): Promise<{ id: string; scheduledDate: string | null }[]> {
  if (jobIds.length === 0) return [];
  const today = todayInLondon();
  const { data, error } = await admin
    .from('jobs')
    .select('id, status, scheduled_date')
    .eq('tenant_id', tenantId)
    .in('id', jobIds);
  if (error || !data) return [];
  const byId = new Map<string, { status: string; scheduledDate: string | null }>();
  for (const raw of data as { id?: unknown; status?: unknown; scheduled_date?: unknown }[]) {
    const id = asId(raw.id);
    const status = asId(raw.status);
    if (!id || !status) continue;
    byId.set(id, { status, scheduledDate: asYmd(raw.scheduled_date) });
  }
  const open: { id: string; scheduledDate: string | null }[] = [];
  for (const id of jobIds) {
    const job = byId.get(id);
    if (!job) continue;
    if (!(RESCHEDULE_STATUSES as readonly string[]).includes(job.status)) continue;
    if (!job.scheduledDate || job.scheduledDate < today) continue;
    open.push({ id, scheduledDate: job.scheduledDate });
  }
  return open;
}

function went(outcome: SendOutcome): boolean {
  return (
    outcome.outcome === 'text_sent' ||
    outcome.outcome === 'text_held' ||
    outcome.outcome === 'email_sent' ||
    outcome.outcome === 'duplicate'
  );
}

async function customerEmail(
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
  return asId((data as { email?: unknown }).email);
}

async function sendPlainReplyEmail(p: {
  to: string;
  ctx: TenantMessagingContext;
  text: string;
}): Promise<{ sent: boolean; error?: string }> {
  const built = buildPlainCustomerEmail({
    businessName: p.ctx.businessName,
    logoUrl: p.ctx.logoUrl,
    subject: FALLBACK_SUBJECTS.reply_ack(p.ctx.businessName),
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

async function sendReplyAck(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    customerId: string;
    messageId: string;
    action: 'skip' | 'move';
    jobIds: string[];
    changeId: string | null;
    originalDate: string | null;
    moveDate: string | null;
  },
): Promise<boolean> {
  const ctx = await getTenantMessagingContext(admin, p.tenantId);
  if (!ctx) return false;
  const brand: SmsBrand = { businessName: ctx.businessName, contactPhone: ctx.contactPhone };
  const text =
    p.action === 'skip'
      ? p.originalDate
        ? replySkipAckSms({ brand, day: formatVisitDay(p.originalDate), nextDay: null })
        : null
      : p.moveDate
        ? replyMoveAckSms({ brand, toDay: formatVisitDay(p.moveDate) })
        : null;
  if (!text) return false;
  const outcome = await sendCustomerMessage({
    tenantId: p.tenantId,
    customerId: p.customerId,
    kind: 'reply_ack',
    dedupeKey: `reply_ack:${p.messageId}`,
    text: () => text,
    email: async () => {
      const to = await customerEmail(admin, p.tenantId, p.customerId);
      if (!to) return { sent: false, error: 'No email' };
      return sendPlainReplyEmail({ to, ctx, text });
    },
    jobIds: p.jobIds,
    visitChangeId: p.changeId,
    bindThread: true,
  });
  const told = went(outcome);
  if (told && p.changeId) {
    // The ack told the customer about this change, so Undo must tell them
    // it's back on. Undo only notifies when notified_at is set.
    const { error } = await admin
      .from('visit_changes')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', p.changeId)
      .eq('tenant_id', p.tenantId)
      .is('notified_at', null);
    if (error) console.error('[sendReplyAck] notified_at', error.message);
  }
  return told;
}
