import 'server-only';

import { addDays, todayInLondon } from '@/lib/rounds/dates';
import { readAllPages } from '@/lib/data/read-all-pages';
import { boardLeadFromSource, mapLeadRow } from '@/lib/data/lite/leads-board';
import type { BoardLead } from '@/lib/data/lite/leads-board';
import { createClient } from '@/lib/supabase/server';
import type { StoredMessage } from '@/lib/widget/conversation';

export type LeadText = {
  id: string;
  kind: 'follow_up' | 'booking_accepted' | 'booking_declined' | 'owner_alert' | 'reply_in';
  status: 'scheduled' | 'sending' | 'sent' | 'emailed' | 'failed' | 'skipped' | 'received';
  skipReason: string | null;
  body: string | null;
  sendAfter: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type LeadDetail = {
  lead: BoardLead & {
    email: string | null;
    preferredDays: string[];
    customerNote: string | null;
    decidedAt: string | null;
    convertedCustomerId: string | null;
    convertedJobId: string | null;
    source: string;
  };
  texts: LeadText[];
  conversation: {
    id: string;
    messages: StoredMessage[];
    summary: string | null;
    tags: string[];
    startedAt: string;
    status: 'active' | 'ended';
  } | null;
};

const KINDS = ['follow_up', 'booking_accepted', 'booking_declined', 'owner_alert', 'reply_in'] as const;
const TEXT_STATUSES = ['scheduled', 'sending', 'sent', 'emailed', 'failed', 'skipped', 'received'] as const;

const DETAIL_COLUMNS =
  'id, name, job_summary, quote_kind, quote_amount, quote_min, quote_max, agreed_amount, status, booking_status, decided_by, created_at, status_changed_at, booked_for_date, booked_for_time, postcode, phone, preferred_days, follow_up_problem, converted_customer_id, converted_job_id, widget_conversation_id, email, customer_note, decided_at, source';

type Tone = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'violet';

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function londonClock(iso: string): { ymd: string; hm: string; dayMonth: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '';
  if (!/^\d{2}$/.test(hour) || !/^\d{2}$/.test(minute)) return null;
  const dayMonth = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
  }).format(date);
  return { ymd, hm: `${hour}:${minute}`, dayMonth };
}

function clockStatus(iso: string | null, prefix: string): string {
  if (!iso) return prefix;
  const clock = londonClock(iso);
  return clock ? `${prefix} ${clock.hm}` : prefix;
}

function goingStatus(sendAfter: string | null, now: Date): string {
  if (!sendAfter) return 'Going soon';
  const clock = londonClock(sendAfter);
  if (!clock) return 'Going soon';
  const today = todayInLondon(now);
  if (clock.ymd === today) return `Going at ${clock.hm}`;
  if (clock.ymd === addDays(today, 1)) return `Going tomorrow at ${clock.hm}`;
  return `Going ${clock.dayMonth} at ${clock.hm}`;
}

const SKIP: Record<string, { status: string; tone: Tone }> = {
  no_texts_left: { status: 'Not sent \u2014 out of texts', tone: 'rose' },
  opted_out: { status: "Not sent \u2014 they've asked for no texts", tone: 'slate' },
  follow_ups_off: { status: "Not sent \u2014 'Text customers for me' is off", tone: 'slate' },
  lead_closed: { status: "Not needed \u2014 you'd already decided", tone: 'slate' },
  no_mobile: { status: 'Not sent \u2014 no mobile saved', tone: 'slate' },
};

function titleFor(kind: LeadText['kind'], firstName: string): string {
  if (kind === 'follow_up') return `Follow-up to ${firstName}`;
  if (kind === 'booking_accepted') return "'Happy to do it' text";
  if (kind === 'booking_declined') return "'Sorry, can't take it' text";
  if (kind === 'owner_alert') return 'Alert to your mobile';
  return `${firstName} replied`;
}

/** Title, status line and colour for one text on the lead page. */
export function textLabel(t: LeadText, firstName: string): { title: string; status: string; tone: Tone } {
  const title = titleFor(t.kind, firstName);
  if (t.status === 'scheduled') return { title, status: goingStatus(t.sendAfter, new Date()), tone: 'sky' };
  if (t.status === 'sending') return { title, status: 'Sending\u2026', tone: 'sky' };
  if (t.status === 'sent') return { title, status: clockStatus(t.sentAt, 'Sent'), tone: 'emerald' };
  if (t.status === 'emailed') return { title, status: 'Emailed instead \u2014 no texts left', tone: 'amber' };
  if (t.status === 'failed') return { title, status: "Didn't send", tone: 'rose' };
  if (t.status === 'received') return { title, status: clockStatus(t.sentAt ?? t.createdAt, 'Received'), tone: 'violet' };
  const skipped = t.skipReason ? SKIP[t.skipReason] : undefined;
  return { title, status: skipped?.status ?? 'Not sent', tone: skipped?.tone ?? 'slate' };
}

function mapText(raw: unknown): LeadText | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.created_at !== 'string') return null;
  if (typeof row.kind !== 'string' || !(KINDS as readonly string[]).includes(row.kind)) return null;
  if (typeof row.status !== 'string' || !(TEXT_STATUSES as readonly string[]).includes(row.status)) return null;
  const kind = row.kind as LeadText['kind'];
  return {
    id: row.id,
    kind,
    status: row.status as LeadText['status'],
    skipReason: asText(row.skip_reason),
    body: kind === 'owner_alert' ? null : asText(row.body),
    sendAfter: asText(row.send_after),
    sentAt: asText(row.sent_at),
    createdAt: row.created_at,
  };
}

function asMessages(raw: unknown): StoredMessage[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const messages: StoredMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string') continue;
    messages.push({
      role: row.role,
      content: row.content,
      at: typeof row.at === 'string' ? row.at : '',
    });
  }
  return messages;
}

function mapConversation(raw: unknown): LeadDetail['conversation'] {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id === '') return null;
  const tags = Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string' && tag !== '') : [];
  return {
    id: row.id,
    messages: asMessages(row.messages),
    summary: asText(row.summary),
    tags,
    startedAt: typeof row.created_at === 'string' ? row.created_at : '',
    status: row.status === 'active' ? 'active' : 'ended',
  };
}

/** Turn a lead row, its texts and its chat into the page's data. Null when the lead row is unusable. */
export function mapLeadDetail(input: {
  lead: unknown;
  texts: unknown[];
  conversation: unknown | null;
}): LeadDetail | null {
  const source = mapLeadRow(input.lead);
  if (!source || !input.lead || typeof input.lead !== 'object') return null;
  const row = input.lead as Record<string, unknown>;
  const texts = input.texts
    .map(mapText)
    .filter((text): text is LeadText => text != null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const replied = texts.some((text) => text.kind === 'reply_in');
  return {
    lead: {
      ...boardLeadFromSource(source, replied),
      email: asText(row.email),
      preferredDays: source.preferredDays,
      customerNote: asText(row.customer_note),
      decidedAt: asText(row.decided_at),
      convertedCustomerId: asText(row.converted_customer_id),
      convertedJobId: asText(row.converted_job_id),
      source: typeof row.source === 'string' && row.source !== '' ? row.source : 'widget',
    },
    texts,
    conversation: mapConversation(input.conversation),
  };
}

async function loadTexts(tenantId: string, leadId: string): Promise<unknown[]> {
  try {
    const supabase = await createClient();
    return await readAllPages(
      (from, to) =>
        supabase
          .from('lite_texts')
          .select('id, kind, status, skip_reason, body, send_after, sent_at, created_at')
          .eq('tenant_id', tenantId)
          .eq('lead_id', leadId)
          .order('created_at', { ascending: true })
          .range(from, to),
      'Could not load texts',
    );
  } catch {
    return [];
  }
}

export async function getLeadDetail(tenantId: string, leadId: string): Promise<LeadDetail | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('leads')
      .select(DETAIL_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', leadId)
      .maybeSingle();
    if (error || !data) return null;
    const conversationId =
      typeof (data as { widget_conversation_id?: unknown }).widget_conversation_id === 'string'
        ? (data as { widget_conversation_id: string }).widget_conversation_id
        : null;
    const [texts, conversationResult] = await Promise.all([
      loadTexts(tenantId, leadId),
      conversationId
        ? supabase
            .from('widget_conversations')
            .select('id, messages, summary, tags, status, created_at')
            .eq('tenant_id', tenantId)
            .eq('id', conversationId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const conversation = conversationResult.error ? null : conversationResult.data;
    return mapLeadDetail({ lead: data, texts, conversation });
  } catch {
    return null;
  }
}
