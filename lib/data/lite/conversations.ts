import 'server-only';

import { londonMonthStart, londonWeekStart } from '@/lib/data/lite/leads-board';
import { readAllPages } from '@/lib/data/read-all-pages';
import { createClient } from '@/lib/supabase/server';
import type { StoredMessage } from '@/lib/widget/conversation';

export type ConversationFilter = 'all' | 'details' | 'no_details' | 'out_of_area';

export type ConversationListItem = {
  id: string;
  startedAt: string;
  lastMessageAt: string | null;
  status: 'active' | 'ended';
  visitorMessages: number;
  summary: string | null;
  tags: string[];
  lead: { id: string; firstName: string; status: 'new' | 'contacted' | 'won' | 'lost' } | null;
  quote: { kind: 'firm' | 'guide' | 'visit'; amount?: number; min?: number; max?: number } | null;
};

const FILTERS = ['all', 'details', 'no_details', 'out_of_area'] as const;
const STATUSES = ['new', 'contacted', 'won', 'lost'] as const;
const PAGE_SIZE = 30;

export type ConversationSource = {
  id: string;
  startedAt: string;
  lastMessageAt: string | null;
  status: 'active' | 'ended';
  visitorMessages: number;
  summary: string | null;
  tags: string[];
  quote: ConversationListItem['quote'];
};

export type ConversationLeadSource = {
  id: string;
  name: string;
  status: string;
  conversationId: string | null;
};

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

function quoteOf(raw: unknown): ConversationListItem['quote'] {
  if (!raw || typeof raw !== 'object') return null;
  const quote = raw as Record<string, unknown>;
  if (quote.kind === 'firm') {
    const amount = asNumber(quote.amount);
    return amount == null ? null : { kind: 'firm', amount };
  }
  if (quote.kind === 'guide') {
    const min = asNumber(quote.min);
    const max = asNumber(quote.max);
    return min == null || max == null ? null : { kind: 'guide', min, max };
  }
  if (quote.kind === 'visit') return { kind: 'visit' };
  return null;
}

function isFilter(value: unknown): value is ConversationFilter {
  return typeof value === 'string' && (FILTERS as readonly string[]).includes(value);
}

/** Unknown filters become All. page=0, blanks and junk become page 1. */
export function normaliseConversationQuery(input: { filter?: unknown; page?: unknown }): {
  filter: ConversationFilter;
  page: number;
} {
  const filter = isFilter(input.filter) ? input.filter : 'all';
  const raw = typeof input.page === 'number' ? String(input.page) : input.page;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    const page = Number(raw);
    if (page >= 1) return { filter, page };
  }
  return { filter, page: 1 };
}

function inRange(iso: string, startMs: number, endMs: number): boolean {
  const time = new Date(iso).getTime();
  return Number.isFinite(time) && time >= startMs && time <= endMs;
}

type LeadStatus = NonNullable<ConversationListItem['lead']>['status'];

function asLeadStatus(value: string): LeadStatus | null {
  return (STATUSES as readonly string[]).includes(value) ? (value as LeadStatus) : null;
}

function leadFor(
  conversationId: string,
  leads: readonly ConversationLeadSource[],
): ConversationListItem['lead'] {
  const match = leads.find((lead) => lead.conversationId === conversationId);
  if (!match) return null;
  const status = asLeadStatus(match.status);
  if (!status) return null;
  const firstName = firstNameOf(match.name);
  if (!firstName) return null;
  return { id: match.id, firstName, status };
}

function toItem(source: ConversationSource, lead: ConversationListItem['lead']): ConversationListItem {
  return {
    id: source.id,
    startedAt: source.startedAt,
    lastMessageAt: source.lastMessageAt,
    status: source.status,
    visitorMessages: source.visitorMessages,
    summary: source.summary,
    tags: source.tags,
    lead,
    quote: source.quote,
  };
}

function matches(source: ConversationSource, filter: ConversationFilter, hasLead: boolean): boolean {
  if (filter === 'details') return hasLead;
  if (filter === 'no_details') return !hasLead;
  if (filter === 'out_of_area') return source.tags.includes('out_of_area');
  return true;
}

/**
 * One page of chats, newest first, plus the week and month counts.
 * Page past the end becomes the last page. An empty list is page 1 of 1.
 */
export function buildConversationList(input: {
  conversations: ConversationSource[];
  leads: readonly ConversationLeadSource[];
  filter: unknown;
  page: unknown;
  now: Date;
}): {
  items: ConversationListItem[];
  page: number;
  pageCount: number;
  counts: {
    thisWeek: number;
    leftDetailsThisWeek: number;
    thisMonth: number;
    outOfAreaThisMonth: number;
  };
} {
  const query = normaliseConversationQuery({ filter: input.filter, page: input.page });
  const leadById = new Map<string, ConversationListItem['lead']>();
  for (const source of input.conversations) {
    leadById.set(source.id, leadFor(source.id, input.leads));
  }

  const matched = input.conversations
    .filter((source) => matches(source, query.filter, leadById.get(source.id) != null))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));

  const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const items = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((source) => toItem(source, leadById.get(source.id) ?? null));

  const weekStart = londonWeekStart(input.now).getTime();
  const monthStart = londonMonthStart(input.now).getTime();
  const nowMs = input.now.getTime();
  let thisWeek = 0;
  let leftDetailsThisWeek = 0;
  let thisMonth = 0;
  let outOfAreaThisMonth = 0;
  for (const source of input.conversations) {
    const inWeek = inRange(source.startedAt, weekStart, nowMs);
    const inMonth = inRange(source.startedAt, monthStart, nowMs);
    if (inWeek) {
      thisWeek += 1;
      if (leadById.get(source.id) != null) leftDetailsThisWeek += 1;
    }
    if (inMonth) {
      thisMonth += 1;
      if (source.tags.includes('out_of_area')) outOfAreaThisMonth += 1;
    }
  }

  return {
    items,
    page,
    pageCount,
    counts: { thisWeek, leftDetailsThisWeek, thisMonth, outOfAreaThisMonth },
  };
}

function asTags(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((tag): tag is string => typeof tag === 'string' && tag !== '') : [];
}

export function mapConversationRow(raw: unknown): ConversationSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id === '') return null;
  const visitors = asNumber(row.visitor_message_count);
  return {
    id: row.id,
    startedAt: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    lastMessageAt: asText(row.last_message_at),
    status: row.status === 'active' ? 'active' : 'ended',
    visitorMessages: visitors != null && visitors >= 0 ? visitors : 0,
    summary: asText(row.summary),
    tags: asTags(row.tags),
    quote: quoteOf(row.last_quote),
  };
}

function mapLeadRow(raw: unknown): ConversationLeadSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null;
  return {
    id: row.id,
    name: row.name,
    status: typeof row.status === 'string' ? row.status : '',
    conversationId: asText(row.widget_conversation_id),
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

const LIST_COLUMNS = 'id, created_at, last_message_at, status, visitor_message_count, summary, tags, last_quote';

export async function listConversations(
  tenantId: string,
  p: { filter: ConversationFilter; page: number },
  now: Date = new Date(),
): Promise<{
  items: ConversationListItem[];
  page: number;
  pageCount: number;
  counts: {
    thisWeek: number;
    leftDetailsThisWeek: number;
    thisMonth: number;
    outOfAreaThisMonth: number;
  };
}> {
  const supabase = await createClient();
  const [chatRows, leadRows] = await Promise.all([
    readAllPages(
      (from, to) =>
        supabase
          .from('widget_conversations')
          .select(LIST_COLUMNS)
          .eq('tenant_id', tenantId)
          .order('id', { ascending: true })
          .range(from, to),
      'Could not load conversations',
    ),
    readAllPages(
      (from, to) =>
        supabase
          .from('leads')
          .select('id, name, status, widget_conversation_id')
          .eq('tenant_id', tenantId)
          .order('id', { ascending: true })
          .range(from, to),
      'Could not load conversations',
    ),
  ]);
  return buildConversationList({
    conversations: chatRows.map(mapConversationRow).filter((row): row is ConversationSource => row != null),
    leads: leadRows.map(mapLeadRow).filter((row): row is ConversationLeadSource => row != null),
    filter: p.filter,
    page: p.page,
    now,
  });
}

export async function getConversation(
  tenantId: string,
  id: string,
): Promise<(ConversationListItem & { messages: StoredMessage[] }) | null> {
  try {
    const supabase = await createClient();
    const [{ data, error }, leadResult] = await Promise.all([
      supabase
        .from('widget_conversations')
        .select(`${LIST_COLUMNS}, messages`)
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('leads')
        .select('id, name, status, widget_conversation_id')
        .eq('tenant_id', tenantId)
        .eq('widget_conversation_id', id)
        .maybeSingle(),
    ]);
    if (error || !data) return null;
    const source = mapConversationRow(data);
    if (!source) return null;
    const lead = leadResult.error ? null : leadFor(source.id, [mapLeadRow(leadResult.data)].filter((row): row is ConversationLeadSource => row != null));
    return {
      ...toItem(source, lead),
      messages: asMessages((data as { messages?: unknown }).messages),
    };
  } catch {
    return null;
  }
}
