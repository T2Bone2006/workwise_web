import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseProfile, type PriceProfile } from '@/lib/lite/profile-schema';
import type { GuardedQuote } from '@/lib/widget/turn-schema';

export type StoredMessage = { role: 'user' | 'assistant'; content: string; at: string };

export type ConversationRow = {
  id: string;
  client_id: string;
  tenant_id: string;
  messages: StoredMessage[];
  visitor_message_count: number;
  status: string;
};

export type PublicQuote =
  | { kind: 'firm'; amount: number; summary: string }
  | { kind: 'guide'; min: number; max: number; summary: string }
  | { kind: 'visit'; summary: string };

function asMessages(raw: unknown): StoredMessage[] {
  if (!Array.isArray(raw)) return [];
  const messages: StoredMessage[] = [];
  for (const item of raw) {
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

function asRow(raw: Record<string, unknown>): ConversationRow | 'error' {
  if (typeof raw.id !== 'string' || typeof raw.client_id !== 'string') return 'error';
  const count = raw.visitor_message_count;
  return {
    id: raw.id,
    client_id: raw.client_id,
    tenant_id: typeof raw.tenant_id === 'string' ? raw.tenant_id : '',
    messages: asMessages(raw.messages),
    visitor_message_count: typeof count === 'number' && Number.isFinite(count) ? count : 0,
    status: typeof raw.status === 'string' ? raw.status : 'active',
  };
}

export async function loadConversation(
  admin: SupabaseClient,
  clientId: string,
  conversationId: string,
): Promise<ConversationRow | null | 'error'> {
  try {
    const { data, error } = await admin
      .from('widget_conversations')
      .select('id, client_id, tenant_id, messages, visitor_message_count, status')
      .eq('id', conversationId)
      .maybeSingle();
    if (error) return 'error';
    if (!data) return null;
    const row = asRow(data as Record<string, unknown>);
    if (row === 'error') return 'error';
    // Returned even when row.client_id !== clientId, so the route can refuse another widget's chat.
    if (row.client_id !== clientId) return row;
    return row;
  } catch {
    return 'error';
  }
}

export async function startConversation(
  admin: SupabaseClient,
  p: { id: string; clientId: string; tenantId: string; visitorHash: string; originHost: string },
): Promise<'ok' | 'exists' | 'error'> {
  try {
    const { error } = await admin.from('widget_conversations').insert({
      id: p.id,
      client_id: p.clientId,
      tenant_id: p.tenantId,
      visitor_hash: p.visitorHash,
      origin_host: p.originHost,
      messages: [],
      status: 'active',
      visitor_message_count: 0,
    });
    if (!error) return 'ok';
    const code = (error as { code?: string }).code;
    if (code === '23505') return 'exists';
    return 'error';
  } catch {
    return 'error';
  }
}

export async function appendVisitorMessage(
  admin: SupabaseClient,
  p: { id: string; expectedCount: number; message: StoredMessage },
): Promise<'ok' | 'busy' | 'error'> {
  try {
    const { data, error } = await admin
      .from('widget_conversations')
      .select('messages')
      .eq('id', p.id)
      .maybeSingle();
    if (error || !data) return 'error';
    const messages = [...asMessages((data as { messages?: unknown }).messages), p.message];
    const { data: updated, error: updateError } = await admin
      .from('widget_conversations')
      .update({
        messages,
        visitor_message_count: p.expectedCount + 1,
        last_message_at: new Date().toISOString(),
        status: 'active',
        ended_at: null,
      })
      .eq('id', p.id)
      .eq('visitor_message_count', p.expectedCount)
      .select('id');
    if (updateError) return 'error';
    if (!updated || updated.length === 0) return 'busy';
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function appendAssistantMessage(
  admin: SupabaseClient,
  p: { id: string; message: StoredMessage; quote: GuardedQuote | null },
): Promise<void> {
  try {
    const { data, error } = await admin
      .from('widget_conversations')
      .select('messages')
      .eq('id', p.id)
      .maybeSingle();
    if (error || !data) {
      console.error('[widget] assistant message not stored', p.id);
      return;
    }
    const messages = [...asMessages((data as { messages?: unknown }).messages), p.message];
    const patch: { messages: StoredMessage[]; last_quote?: GuardedQuote } = { messages };
    if (p.quote) patch.last_quote = p.quote;
    const { error: updateError } = await admin.from('widget_conversations').update(patch).eq('id', p.id);
    if (updateError) console.error('[widget] assistant message not stored', p.id);
  } catch {
    console.error('[widget] assistant message not stored', p.id);
  }
}

export function toPublicQuote(q: GuardedQuote | null): PublicQuote | null {
  if (!q) return null;
  if (q.kind === 'firm') return { kind: 'firm', amount: q.amount, summary: q.summary };
  if (q.kind === 'guide') return { kind: 'guide', min: q.min, max: q.max, summary: q.summary };
  return { kind: 'visit', summary: q.summary };
}

/** Error or a broken profile → null, so the bot stays in enquiry mode. */
export async function loadWidgetProfile(admin: SupabaseClient, tenantId: string): Promise<PriceProfile | null> {
  try {
    const { data, error } = await admin
      .from('lite_price_profiles')
      .select('profile')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error || !data) return null;
    return parseProfile((data as { profile?: unknown }).profile);
  } catch {
    return null;
  }
}
