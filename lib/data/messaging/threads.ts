import type { SupabaseClient } from '@supabase/supabase-js';
import {
  contactChoiceFromColumn,
  type ContactChoice,
} from '@/lib/messaging/channel';
import { isValidYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-transitions';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';

export type ReplyLabel = {
  kind: 'said_no' | 'asked_move' | 'replied';
  visitDate: string | null;
  requestedDate: string | null;
};

export type ThreadListItem = {
  id: string;
  customerId: string;
  customerName: string;
  status: 'open' | 'needs_attention' | 'closed';
  reason: string | null;
  unread: number;
  lastAt: string | null;
  preview: string;
  previewDirection: 'inbound' | 'outbound';
  label: ReplyLabel | null;
  /** Set once the trader has acted and nothing is still waiting. */
  handled: 'skipped' | 'moved' | 'kept' | 'dismissed' | null;
  /** Topic of the latest reply, including one already handled. */
  topic: 'said_no' | 'asked_move' | 'replied' | null;
};

export type ThreadMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  channel: 'sms' | 'email' | 'whatsapp';
  kind: string;
  body: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  classification: string | null;
  requestedDate: string | null;
  handledAction: string | null;
  error: string | null;
};

export type ThreadDetail = {
  thread: ThreadListItem;
  customer: {
    id: string;
    name: string;
    phoneDisplay: string | null;
    email: string | null;
    contactChoice: ContactChoice;
    optedOut: boolean;
  };
  messages: ThreadMessage[];
  pending: null | {
    messageId: string;
    intent: 'said_no' | 'asked_move' | 'question';
    jobIds: string[];
    visitDate: string | null;
    requestedDate: string | null;
    /** A reply to a money text: offer Mark paid, never Skip / Keep / Move. */
    aboutPayment: 'says_paid' | 'payment_question' | null;
  };
};

/** Must match PAYMENT_REPLY_REASONS in lib/messaging/inbound.ts. */
function paymentReplyFromReason(reason: string | null): 'says_paid' | 'payment_question' | null {
  if (reason === "Says they've paid") return 'says_paid';
  if (reason === 'About a payment') return 'payment_question';
  return null;
}

const PREVIEW_CHARS = 80;
const DEFAULT_THREAD_LIMIT = 50;
const THREAD_MESSAGE_LIMIT = 100;
const DEFAULT_RECENT_LIMIT = 5;

const MESSAGE_COLUMNS =
  'id, thread_id, direction, channel, kind, body, status, created_at, sent_at, delivered_at, classification, requested_date, handled_action, error';

type ThreadStatus = ThreadListItem['status'];

type ThreadRow = {
  id?: unknown;
  customer_id?: unknown;
  status?: unknown;
  needs_attention_reason?: unknown;
  unread_count?: unknown;
  last_inbound_at?: unknown;
  last_outbound_at?: unknown;
  active_job_ids?: unknown;
  customers?: unknown;
  messages?: unknown;
};

type FlagRow = {
  messageId: string;
  threadId: string;
  classification: 'said_no' | 'asked_move' | 'question';
  requestedDate: string | null;
  jobIds: string[];
};

type OpenJobs = { jobIds: string[]; visitDate: string | null };

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asYmd(value: unknown): Ymd | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const sliced = value.slice(0, 10);
  return isValidYmd(sliced) ? sliced : null;
}

function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id !== '');
}

function asStatus(value: unknown): ThreadStatus | null {
  if (value === 'open' || value === 'needs_attention' || value === 'closed') return value;
  return null;
}

function asUnread(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stampMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function embedList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === 'object') return [value as Record<string, unknown>];
  return [];
}

function embedName(value: unknown): string {
  return asString(embedList(value)[0]?.name) ?? 'Customer';
}

function laterStamp(inbound: unknown, outbound: unknown): string | null {
  const inboundMs = stampMs(inbound);
  const outboundMs = stampMs(outbound);
  if (inboundMs == null) return outboundMs == null ? null : (outbound as string);
  if (outboundMs == null) return inbound as string;
  return inboundMs >= outboundMs ? (inbound as string) : (outbound as string);
}

function activityMs(row: ThreadRow, filter: 'attention' | 'all'): number {
  if (filter === 'attention') {
    return stampMs(row.last_inbound_at) ?? Number.NEGATIVE_INFINITY;
  }
  const inbound = stampMs(row.last_inbound_at);
  const outbound = stampMs(row.last_outbound_at);
  if (inbound == null && outbound == null) return Number.NEGATIVE_INFINITY;
  return Math.max(inbound ?? Number.NEGATIVE_INFINITY, outbound ?? Number.NEGATIVE_INFINITY);
}

function previewFromEmbed(value: unknown): {
  preview: string;
  previewDirection: 'inbound' | 'outbound';
} {
  const row = embedList(value)[0];
  if (!row) return { preview: '', previewDirection: 'inbound' };
  const body = typeof row.body === 'string' ? row.body : '';
  const previewDirection = row.direction === 'outbound' ? 'outbound' : 'inbound';
  return { preview: body.slice(0, PREVIEW_CHARS), previewDirection };
}

function displayPhone(e164: string | null, phone: string | null): string | null {
  const formatted = formatUkPhoneDisplay(e164);
  if (formatted) return formatted;
  return phone;
}

function asClassification(value: unknown): FlagRow['classification'] | null {
  if (value === 'said_no' || value === 'asked_move' || value === 'question') return value;
  return null;
}

function mapMessage(row: Record<string, unknown>): ThreadMessage | null {
  const id = asString(row.id);
  const createdAt = asString(row.created_at);
  const direction =
    row.direction === 'inbound' || row.direction === 'outbound' ? row.direction : null;
  const channel =
    row.channel === 'sms' || row.channel === 'email' || row.channel === 'whatsapp'
      ? row.channel
      : null;
  if (!id || !createdAt || !direction || !channel) return null;
  return {
    id,
    direction,
    channel,
    kind: typeof row.kind === 'string' ? row.kind : '',
    body: typeof row.body === 'string' ? row.body : '',
    status: typeof row.status === 'string' ? row.status : '',
    createdAt,
    sentAt: asString(row.sent_at),
    deliveredAt: asString(row.delivered_at),
    classification: asString(row.classification),
    requestedDate: asYmd(row.requested_date),
    handledAction: asString(row.handled_action),
    error: asString(row.error),
  };
}

function readCustomer(
  value: unknown,
  fallbackId: string,
): ThreadDetail['customer'] {
  const row = embedList(value)[0] ?? {};
  const optedAt = row.messaging_opt_out_at;
  return {
    id: asString(row.id) ?? fallbackId,
    name: asString(row.name) ?? 'Customer',
    phoneDisplay: displayPhone(asString(row.phone_e164), asString(row.phone)),
    email: asString(row.email),
    contactChoice: contactChoiceFromColumn(
      typeof row.preferred_channel === 'string' ? row.preferred_channel : null,
    ),
    optedOut: typeof optedAt === 'string' && optedAt.trim() !== '',
  };
}

function stillToDo(
  jobIds: string[],
  jobs: Map<string, { status: string; scheduledDate: string | null }>,
  today: Ymd,
): OpenJobs {
  const open: string[] = [];
  let visitDate: string | null = null;
  for (const id of jobIds) {
    const job = jobs.get(id);
    if (!job) continue;
    if (!(RESCHEDULE_STATUSES as readonly string[]).includes(job.status)) continue;
    if (!job.scheduledDate || job.scheduledDate < today) continue;
    open.push(id);
    if (visitDate == null) visitDate = job.scheduledDate;
  }
  return { jobIds: open, visitDate };
}

function intentFromReason(reason: string | null): 'said_no' | 'asked_move' | 'question' {
  if (reason === 'Said no') return 'said_no';
  if (reason === 'Asked to move') return 'asked_move';
  return 'question';
}

async function customerNextStop(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<OpenJobs> {
  const today = todayInLondon();
  const { data, error } = await supabase
    .from('jobs')
    .select('id, scheduled_date')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .in('status', [...RESCHEDULE_STATUSES])
    .gte('scheduled_date', today)
    .order('scheduled_date', { ascending: true });
  if (error || !data) {
    if (error) console.error('[messaging threads] customer visits', error);
    return { jobIds: [], visitDate: null };
  }
  const rows = data as Record<string, unknown>[];
  const firstDate = asYmd(rows[0]?.scheduled_date);
  if (!firstDate) return { jobIds: [], visitDate: null };
  const jobIds = rows
    .filter((row) => asYmd(row.scheduled_date) === firstDate)
    .map((row) => asString(row.id))
    .filter((id): id is string => id != null);
  return { jobIds, visitDate: firstDate };
}

function labelFromFlag(flag: FlagRow, visitDate: string | null): ReplyLabel {
  return {
    kind: flag.classification === 'question' ? 'replied' : flag.classification,
    visitDate,
    requestedDate: flag.classification === 'asked_move' ? flag.requestedDate : null,
  };
}

async function loadJobs(
  supabase: SupabaseClient,
  tenantId: string,
  jobIds: string[],
): Promise<Map<string, { status: string; scheduledDate: string | null }>> {
  const map = new Map<string, { status: string; scheduledDate: string | null }>();
  const unique = [...new Set(jobIds)];
  if (unique.length === 0) return map;

  const { data, error } = await supabase
    .from('jobs')
    .select('id, status, scheduled_date')
    .eq('tenant_id', tenantId)
    .in('id', unique);
  if (error || !data) {
    if (error) console.error('[messaging threads] jobs', error);
    return map;
  }

  for (const raw of data as Record<string, unknown>[]) {
    const id = asString(raw.id);
    const status = asString(raw.status);
    if (!id || !status) continue;
    map.set(id, { status, scheduledDate: asYmd(raw.scheduled_date) });
  }
  return map;
}

async function loadNewestFlags(
  supabase: SupabaseClient,
  tenantId: string,
  threadIds: string[],
): Promise<Map<string, FlagRow>> {
  const map = new Map<string, FlagRow>();
  if (threadIds.length === 0) return map;

  const { data, error } = await supabase
    .from('messages')
    .select('id, thread_id, classification, requested_date, job_ids, created_at')
    .eq('tenant_id', tenantId)
    .in('thread_id', threadIds)
    .eq('direction', 'inbound')
    .is('handled_at', null)
    .in('classification', ['said_no', 'asked_move', 'question'])
    .order('created_at', { ascending: false });
  if (error || !data) {
    if (error) console.error('[messaging threads] flags', error);
    return map;
  }

  for (const raw of data as Record<string, unknown>[]) {
    const threadId = asString(raw.thread_id);
    const messageId = asString(raw.id);
    const classification = asClassification(raw.classification);
    if (!threadId || !messageId || !classification || map.has(threadId)) continue;
    map.set(threadId, {
      messageId,
      threadId,
      classification,
      requestedDate: asYmd(raw.requested_date),
      jobIds: asIdList(raw.job_ids),
    });
  }
  return map;
}

type HandledMark = {
  action: Exclude<ThreadListItem['handled'], null>;
  kind: NonNullable<ThreadListItem['topic']>;
};

function asHandledAction(value: unknown): ThreadListItem['handled'] {
  if (value === 'skipped' || value === 'moved' || value === 'kept' || value === 'dismissed') {
    return value;
  }
  return null;
}

async function loadNewestHandled(
  supabase: SupabaseClient,
  tenantId: string,
  threadIds: string[],
): Promise<Map<string, HandledMark>> {
  const map = new Map<string, HandledMark>();
  if (threadIds.length === 0) return map;

  const { data, error } = await supabase
    .from('messages')
    .select('thread_id, classification, handled_action, created_at')
    .eq('tenant_id', tenantId)
    .in('thread_id', threadIds)
    .eq('direction', 'inbound')
    .not('handled_at', 'is', null)
    .in('classification', ['said_no', 'asked_move', 'question'])
    .order('created_at', { ascending: false });
  if (error || !data) {
    if (error) console.error('[messaging threads] handled', error);
    return map;
  }

  for (const raw of data as Record<string, unknown>[]) {
    const threadId = asString(raw.thread_id);
    const action = asHandledAction(raw.handled_action);
    const classification = asClassification(raw.classification);
    if (!threadId || !action || !classification || map.has(threadId)) continue;
    map.set(threadId, {
      action,
      kind: classification === 'question' ? 'replied' : classification,
    });
  }
  return map;
}

async function openVisitsForFlags(
  supabase: SupabaseClient,
  tenantId: string,
  flags: Map<string, FlagRow>,
): Promise<Map<string, OpenJobs>> {
  const jobIds: string[] = [];
  for (const flag of flags.values()) jobIds.push(...flag.jobIds);
  const jobs = await loadJobs(supabase, tenantId, jobIds);
  const today = todayInLondon();
  const open = new Map<string, OpenJobs>();
  for (const [threadId, flag] of flags) {
    open.set(threadId, stillToDo(flag.jobIds, jobs, today));
  }
  return open;
}

async function loadMessages(
  supabase: SupabaseClient,
  tenantId: string,
  filter: { threadId?: string; customerId?: string },
  limit: number,
): Promise<{ messages: ThreadMessage[]; threadId: string | null }> {
  let query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (filter.threadId) query = query.eq('thread_id', filter.threadId);
  if (filter.customerId) query = query.eq('customer_id', filter.customerId);

  const { data, error } = await query;
  if (error || !data) {
    if (error) console.error('[messaging threads] messages', error);
    return { messages: [], threadId: null };
  }

  let threadId: string | null = null;
  const messages: ThreadMessage[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    if (threadId == null) threadId = asString(raw.thread_id);
    const message = mapMessage(raw);
    if (message) messages.push(message);
  }
  return { messages, threadId };
}

function toListItem(
  row: ThreadRow,
  id: string,
  customerId: string,
  status: ThreadStatus,
  customerName: string,
  preview: { preview: string; previewDirection: 'inbound' | 'outbound' },
  label: ReplyLabel | null,
  handled: ThreadListItem['handled'],
  topic: ThreadListItem['topic'],
): ThreadListItem {
  return {
    id,
    customerId,
    customerName,
    status,
    reason: asString(row.needs_attention_reason),
    unread: asUnread(row.unread_count),
    lastAt: laterStamp(row.last_inbound_at, row.last_outbound_at),
    preview: preview.preview,
    previewDirection: preview.previewDirection,
    label,
    handled,
    topic,
  };
}

export async function getThreads(
  supabase: SupabaseClient,
  tenantId: string,
  opts: { filter: 'attention' | 'all'; limit?: number },
): Promise<ThreadListItem[]> {
  const limit =
    typeof opts.limit === 'number' && opts.limit >= 0
      ? Math.floor(opts.limit)
      : DEFAULT_THREAD_LIMIT;
  const messageEmbed =
    opts.filter === 'all'
      ? 'messages!inner(direction, body, created_at)'
      : 'messages(direction, body, created_at)';

  let query = supabase
    .from('message_threads')
    .select(
      `id, customer_id, status, needs_attention_reason, unread_count, last_inbound_at, last_outbound_at, customers(name), ${messageEmbed}`,
    )
    .eq('tenant_id', tenantId);
  if (opts.filter === 'attention') {
    query = query.eq('status', 'needs_attention');
  }

  const { data, error } = await query
    .order('created_at', { ascending: false, foreignTable: 'messages' })
    .limit(1, { foreignTable: 'messages' });
  if (error) {
    console.error('[getThreads]', error);
    return [];
  }

  const sorted = ([...(Array.isArray(data) ? data : [])] as ThreadRow[]).sort(
    (a, b) => activityMs(b, opts.filter) - activityMs(a, opts.filter),
  );

  const picked: Array<{
    row: ThreadRow;
    id: string;
    customerId: string;
    status: ThreadStatus;
  }> = [];
  for (const row of sorted) {
    if (picked.length >= limit) break;
    const id = asString(row.id);
    const customerId = asString(row.customer_id);
    const status = asStatus(row.status);
    if (!id || !customerId || !status) continue;
    picked.push({ row, id, customerId, status });
  }

  const ids = picked.map((item) => item.id);
  const [flags, handledByThread] = await Promise.all([
    loadNewestFlags(supabase, tenantId, ids),
    loadNewestHandled(supabase, tenantId, ids),
  ]);
  const openByThread = await openVisitsForFlags(supabase, tenantId, flags);

  return picked.map(({ row, id, customerId, status }) => {
    const flag = flags.get(id);
    const visitDate = openByThread.get(id)?.visitDate ?? null;
    const handledMark = flag ? null : (handledByThread.get(id) ?? null);
    const label = flag ? labelFromFlag(flag, visitDate) : null;
    return toListItem(
      row,
      id,
      customerId,
      status,
      embedName(row.customers),
      previewFromEmbed(row.messages),
      label,
      handledMark?.action ?? null,
      label?.kind ?? handledMark?.kind ?? null,
    );
  });
}

export async function getThread(
  supabase: SupabaseClient,
  tenantId: string,
  threadId: string,
): Promise<ThreadDetail | null> {
  const { data, error } = await supabase
    .from('message_threads')
    .select(
      `id, customer_id, status, needs_attention_reason, unread_count, last_inbound_at, last_outbound_at, active_job_ids,
       customers(id, name, phone, phone_e164, email, preferred_channel, messaging_opt_out_at)`,
    )
    .eq('tenant_id', tenantId)
    .eq('id', threadId)
    .maybeSingle();
  if (error) {
    console.error('[getThread]', error);
    return null;
  }
  if (!data) return null;

  const row = data as ThreadRow;
  const id = asString(row.id);
  const customerId = asString(row.customer_id);
  const status = asStatus(row.status);
  if (!id || !customerId || !status) return null;

  const [loaded, flags] = await Promise.all([
    loadMessages(supabase, tenantId, { threadId: id }, THREAD_MESSAGE_LIMIT),
    loadNewestFlags(supabase, tenantId, [id]),
  ]);
  const openByThread = await openVisitsForFlags(supabase, tenantId, flags);
  const flag = flags.get(id) ?? null;
  let visit = flag ? (openByThread.get(id) ?? { jobIds: [], visitDate: null }) : { jobIds: [], visitDate: null as string | null };
  if (status === 'needs_attention' && visit.jobIds.length === 0) {
    const active = stillToDo(asIdList(row.active_job_ids), await loadJobs(supabase, tenantId, asIdList(row.active_job_ids)), todayInLondon());
    visit = active.jobIds.length > 0 ? active : await customerNextStop(supabase, tenantId, customerId);
  }
  const newest = loaded.messages[0] ?? null;
  const inbound = loaded.messages.find((message) => message.direction === 'inbound') ?? null;
  const customer = readCustomer(row.customers, customerId);
  const intent = flag?.classification ?? intentFromReason(asString(row.needs_attention_reason));
  const aboutPayment = paymentReplyFromReason(asString(row.needs_attention_reason));
  const label = status === 'needs_attention'
    ? {
        kind: intent === 'question' ? ('replied' as const) : intent,
        visitDate: visit.visitDate,
        requestedDate: intent === 'asked_move' ? (flag?.requestedDate ?? null) : null,
      }
    : null;

  return {
    thread: toListItem(
      row,
      id,
      customerId,
      status,
      customer.name,
      newest
        ? {
            preview: newest.body.slice(0, PREVIEW_CHARS),
            previewDirection: newest.direction,
          }
        : { preview: '', previewDirection: 'inbound' },
      label,
      null,
      flag ? (flag.classification === 'question' ? 'replied' : flag.classification) : label?.kind ?? null,
    ),
    customer,
    messages: loaded.messages.slice().reverse(),
    pending:
      status === 'needs_attention'
        ? {
            messageId: flag?.messageId ?? inbound?.id ?? '',
            intent,
            jobIds: aboutPayment ? [] : visit.jobIds,
            visitDate: aboutPayment ? null : visit.visitDate,
            requestedDate: intent === 'asked_move' ? (flag?.requestedDate ?? null) : null,
            aboutPayment,
          }
        : null,
  };
}

export async function getNeedsAttentionCount(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('message_threads')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'needs_attention');
  if (error) {
    console.error('[getNeedsAttentionCount]', error);
    return 0;
  }
  return count ?? 0;
}

/** Sidebar dot: threads the trader has not opened yet. */
export async function getUnreadThreadCount(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('message_threads')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gt('unread_count', 0);
  if (error) {
    console.error('[getUnreadThreadCount]', error);
    return 0;
  }
  return count ?? 0;
}

export async function getAllThreadsCount(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('message_threads')
    .select('id, messages!inner(id)', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  if (error) {
    console.error('[getAllThreadsCount]', error);
    return 0;
  }
  return count ?? 0;
}

export async function getCustomerRecentMessages(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
  limit?: number,
): Promise<{ threadId: string | null; messages: ThreadMessage[] }> {
  const cap =
    typeof limit === 'number' && limit >= 0 ? Math.floor(limit) : DEFAULT_RECENT_LIMIT;
  if (cap === 0) return { threadId: null, messages: [] };

  const loaded = await loadMessages(supabase, tenantId, { customerId }, cap);
  return {
    threadId: loaded.threadId,
    messages: loaded.messages.slice().reverse(),
  };
}
