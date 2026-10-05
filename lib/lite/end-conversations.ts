import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { ruleTags, summariseConversation, type ConversationTag } from '@/lib/lite/summarise';
import type { StoredMessage } from '@/lib/widget/conversation';
import type { GuardedQuote } from '@/lib/widget/turn-schema';

const IDLE_MS = 20 * 60 * 1000;
const DEFAULT_LIMIT = 20;

type IdleRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  messages: StoredMessage[];
  last_message_at: string;
  last_quote: GuardedQuote | null;
};

function asMessages(raw: unknown): StoredMessage[] {
  if (!Array.isArray(raw)) return [];
  const messages: StoredMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string') continue;
    messages.push({ role: row.role, content: row.content, at: typeof row.at === 'string' ? row.at : '' });
  }
  return messages;
}

function asQuote(raw: unknown): GuardedQuote | null {
  if (!raw || typeof raw !== 'object') return null;
  const quote = raw as Record<string, unknown>;
  const summary = typeof quote.summary === 'string' ? quote.summary : '';
  const key =
    typeof quote.jobTypeKey === 'string'
      ? quote.jobTypeKey
      : typeof quote.job_type_key === 'string'
        ? quote.job_type_key
        : null;
  if (quote.kind === 'firm' && typeof quote.amount === 'number' && key) {
    return { kind: 'firm', jobTypeKey: key, amount: quote.amount, summary };
  }
  if (quote.kind === 'guide' && typeof quote.min === 'number' && typeof quote.max === 'number' && key) {
    return { kind: 'guide', jobTypeKey: key, min: quote.min, max: quote.max, summary };
  }
  if (quote.kind === 'visit') return { kind: 'visit', jobTypeKey: key, summary };
  return null;
}

function asIdle(raw: unknown): IdleRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.tenant_id !== 'string' || typeof row.client_id !== 'string') return null;
  if (typeof row.last_message_at !== 'string' || row.last_message_at === '') return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    client_id: row.client_id,
    messages: asMessages(row.messages),
    last_message_at: row.last_message_at,
    last_quote: asQuote(row.last_quote),
  };
}

function mergeTags(rule: ConversationTag[], ai: ConversationTag[]): ConversationTag[] {
  const tags: ConversationTag[] = [];
  for (const tag of [...rule, ...ai]) {
    if (tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length === 6) break;
  }
  return tags;
}

async function businessName(admin: SupabaseClient, row: IdleRow): Promise<string> {
  const { data, error } = await admin
    .from('widget_clients')
    .select('business_name')
    .eq('id', row.client_id)
    .eq('tenant_id', row.tenant_id)
    .maybeSingle();
  if (error || !data) return 'the business';
  const name = (data as { business_name?: unknown }).business_name;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : 'the business';
}

async function leadFor(admin: SupabaseClient, row: IdleRow): Promise<{ hasLead: boolean; bookingRequested: boolean } | 'error'> {
  const { data, error } = await admin
    .from('leads')
    .select('booking_status')
    .eq('tenant_id', row.tenant_id)
    .eq('widget_conversation_id', row.id)
    .maybeSingle();
  if (error) return 'error';
  if (!data) return { hasLead: false, bookingRequested: false };
  const status = (data as { booking_status?: unknown }).booking_status;
  return {
    hasLead: true,
    bookingRequested: status === 'requested' || status === 'accepted',
  };
}

async function claimEnd(admin: SupabaseClient, row: IdleRow, now: Date): Promise<boolean> {
  const { data, error } = await admin
    .from('widget_conversations')
    .update({ status: 'ended', ended_at: now.toISOString() })
    .eq('id', row.id)
    .eq('tenant_id', row.tenant_id)
    .eq('status', 'active')
    .eq('last_message_at', row.last_message_at)
    .select('id');
  if (error) throw new Error('end_failed');
  return Array.isArray(data) && data.length > 0;
}

/** Put a chat back if the lead read or the summary write failed, unless the visitor has written since. */
async function releaseEnd(admin: SupabaseClient, row: IdleRow): Promise<'released' | 'gone' | 'failed'> {
  const { data, error } = await admin
    .from('widget_conversations')
    .update({ status: 'active', ended_at: null })
    .eq('id', row.id)
    .eq('tenant_id', row.tenant_id)
    .eq('status', 'ended')
    .eq('last_message_at', row.last_message_at)
    .select('id');
  if (error) {
    console.error('[lite-tick] release', row.id);
    return 'failed';
  }
  return Array.isArray(data) && data.length > 0 ? 'released' : 'gone';
}

async function writeSummary(
  admin: SupabaseClient,
  row: IdleRow,
  summary: string | null,
  tags: ConversationTag[],
): Promise<void> {
  const { error } = await admin
    .from('widget_conversations')
    .update({ summary, tags })
    .eq('id', row.id)
    .eq('tenant_id', row.tenant_id);
  if (error) throw new Error('summary_failed');
}

export async function endIdleConversations(
  admin: SupabaseClient,
  now: Date,
  limit = DEFAULT_LIMIT,
): Promise<{ ended: number; summarised: number }> {
  const cutoff = new Date(now.getTime() - IDLE_MS).toISOString();
  const { data, error } = await admin
    .from('widget_conversations')
    .select('id, tenant_id, client_id, messages, last_message_at, last_quote')
    .eq('status', 'active')
    .lt('last_message_at', cutoff)
    .order('last_message_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error('idle_failed');

  const rows = (Array.isArray(data) ? data : []).map(asIdle).filter((row): row is IdleRow => row != null);
  let ended = 0;
  let summarised = 0;

  for (const row of rows) {
    const claimed = await claimEnd(admin, row, now);
    if (!claimed) continue;
    let keepEnded = true;
    try {
      const lead = await leadFor(admin, row);
      if (lead === 'error') {
        console.error('[lite-tick] lead', row.id);
        keepEnded = (await releaseEnd(admin, row)) === 'failed';
      } else {
        const rules = ruleTags({ ...lead, lastQuote: row.last_quote });
        const drafted = await summariseConversation(admin, {
          tenantId: row.tenant_id,
          conversationId: row.id,
          businessName: await businessName(admin, row),
          messages: row.messages,
        });
        await writeSummary(admin, row, drafted.summary, mergeTags(rules, drafted.aiTags));
        if (drafted.summary) summarised += 1;
      }
    } catch (err) {
      const name = err instanceof Error && err.name ? err.name : 'Error';
      console.error('[lite-tick] summary', row.id, name);
      keepEnded = (await releaseEnd(admin, row)) === 'failed';
    }
    if (keepEnded) ended += 1;
  }

  return { ended, summarised };
}
