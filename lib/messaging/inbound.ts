import 'server-only';

import { handleLeadReply } from '@/lib/lite/lead-replies';
import { classifyPaymentReply, classifyReply, type ReplyIntent } from '@/lib/messaging/classify';
import { pushReplyToOwner } from '@/lib/messaging/owner-push';
import { applyReplyOutcome } from '@/lib/messaging/replies';
import type { KeywordMatch } from '@/lib/messaging/keywords';
import { matchKeyword, normaliseReply } from '@/lib/messaging/keywords';
import { recordOptIn, recordOptOut } from '@/lib/messaging/opt-outs';
import { maskPhone } from '@/lib/messaging/phone';
import type { InboundEvent } from '@/lib/messaging/provider';
import { routeInbound } from '@/lib/messaging/route-inbound';
import { sendPlatformText } from '@/lib/messaging/send';
import { UNKNOWN_NUMBER_SMS } from '@/lib/messaging/templates';
import { isValidYmd, todayInLondon } from '@/lib/rounds/dates';
import { createAdminClient } from '@/lib/supabase/admin';

export type InboundOutcome =
  | 'blocked'
  | 'duplicate'
  | 'opt_out'
  | 'opt_in'
  | 'unknown_autoreplied'
  | 'unknown_stored'
  | 'lead_reply'
  | 'recorded';

const BODY_LIMIT = 1600;
const PROVIDER = 'puresms';

function isE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

function clipBody(body: string): string {
  return body.length > BODY_LIMIT ? body.slice(0, BODY_LIMIT) : body;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function providerMessageId(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function countRow(data: unknown): { isBlocked: boolean } | null {
  const raw = Array.isArray(data) ? data[0] : data;
  const row = asRecord(raw);
  if (!row || typeof row.is_blocked !== 'boolean') return null;
  return { isBlocked: row.is_blocked };
}

function logFailure(scope: string, err: unknown): void {
  console.error(`[${scope}]`, err instanceof Error ? err.message : 'failed');
}

/** A redelivery of a text we already stored must not count again. */
async function alreadyStored(
  admin: ReturnType<typeof createAdminClient>,
  providerMessageId: string,
): Promise<boolean> {
  const { data: message, error: messageError } = await admin
    .from('messages')
    .select('id')
    .eq('provider', PROVIDER)
    .eq('provider_message_id', providerMessageId)
    .maybeSingle();
  if (messageError) throw new Error(messageError.message);
  if (message) return true;

  const { data: unrouted, error: unroutedError } = await admin
    .from('messaging_unrouted_inbound')
    .select('id')
    .eq('provider', PROVIDER)
    .eq('provider_message_id', providerMessageId)
    .maybeSingle();
  if (unroutedError) throw new Error(unroutedError.message);
  if (unrouted) return true;

  const { data: leadText, error: leadTextError } = await admin
    .from('lite_texts')
    .select('id')
    .eq('provider', PROVIDER)
    .eq('provider_message_id', providerMessageId)
    .maybeSingle();
  if (leadTextError) throw new Error(leadTextError.message);
  return Boolean(leadText);
}

function asYmd(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const sliced = value.slice(0, 10);
  return isValidYmd(sliced) ? sliced : null;
}

function attentionReason(intent: ReplyIntent): string | null {
  if (intent === 'other') return null;
  if (intent === 'said_no') return 'Said no';
  if (intent === 'asked_move') return 'Asked to move';
  return 'Sent a message';
}

async function businessNameFor(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<string> {
  const { data, error } = await admin
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();
  if (error || !data) return 'Your business';
  const name = (data as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : 'Your business';
}

async function visitDateFor(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  boundJobIds: string[],
): Promise<string | null> {
  const jobId = boundJobIds[0];
  if (!jobId) return null;
  const { data, error } = await admin
    .from('jobs')
    .select('scheduled_date')
    .eq('tenant_id', tenantId)
    .eq('id', jobId)
    .maybeSingle();
  if (error || !data) return null;
  return asYmd((data as { scheduled_date?: unknown }).scheduled_date);
}

/** Needs-attention reasons for replies to money texts. Read by the review screens. */
export const PAYMENT_REPLY_REASONS = {
  says_paid: "Says they've paid",
  payment_question: 'About a payment',
} as const;

const MONEY_KINDS = new Set(['visit_done', 'chaser', 'payment_received']);
const MONEY_CONTEXT_MS = 14 * 86_400_000;

/**
 * True when the newest text we sent this customer (last 14 days) was about
 * money — then "no" means "no, I paid", not "skip my visit". Reply acks are
 * ignored: they answer a visit reply. Fails to false (the visit sorter).
 */
async function lastTextWasAboutMoney(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  threadId: string,
  now: Date,
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from('messages')
      .select('kind, created_at')
      .eq('tenant_id', tenantId)
      .eq('thread_id', threadId)
      .eq('direction', 'outbound')
      .in('kind', ['reminder', 'visit_change', 'visit_done', 'chaser', 'payment_received'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      console.error('[lastTextWasAboutMoney]', error.message);
      return false;
    }
    const row = (data ?? [])[0] as { kind?: unknown; created_at?: unknown } | undefined;
    if (!row || typeof row.kind !== 'string' || !MONEY_KINDS.has(row.kind)) return false;
    const at = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN;
    return Number.isFinite(at) && now.getTime() - at <= MONEY_CONTEXT_MS;
  } catch (err) {
    console.error('[lastTextWasAboutMoney]', err instanceof Error ? err.message : err);
    return false;
  }
}

/** A reply to a money text: labelled for the trader, never offered as a skip or move. */
async function classifyPaymentAndAct(
  admin: ReturnType<typeof createAdminClient>,
  p: { tenantId: string; threadId: string; customerId: string; messageId: string; body: string },
): Promise<void> {
  const sorted = await classifyPaymentReply(admin, {
    tenantId: p.tenantId,
    messageId: p.messageId,
    body: p.body,
    businessName: await businessNameFor(admin, p.tenantId),
  });

  const { error } = await admin
    .from('messages')
    .update({
      classification: sorted.intent === 'other' ? 'other' : 'question',
      classification_confidence: sorted.confidence,
      requested_date: null,
    })
    .eq('id', p.messageId)
    .eq('tenant_id', p.tenantId);
  if (error) throw new Error(error.message);

  const reason = sorted.intent === 'other' ? null : PAYMENT_REPLY_REASONS[sorted.intent];
  const { error: noteError } = await admin.rpc('messaging_note_inbound', {
    p_thread_id: p.threadId,
    p_needs_attention: reason != null,
    p_reason: reason,
  });
  if (noteError) throw new Error(noteError.message);

  if (sorted.intent === 'other') return;
  const { data: customer } = await admin
    .from('customers')
    .select('name')
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  const name = (customer as { name?: unknown } | null)?.name;
  await pushReplyToOwner(admin, p.tenantId, {
    customerName: typeof name === 'string' && name.trim() ? name.trim() : 'A customer',
    intent: 'question',
    visitDate: null,
    requestedDate: null,
    body: p.body,
    threadId: p.threadId,
    jobId: null,
    aboutPayment: sorted.intent,
  });
}

export async function classifyAndAct(p: {
  tenantId: string;
  threadId: string;
  customerId: string;
  messageId: string;
  body: string;
  boundJobIds: string[];
  keyword: KeywordMatch | null;
  now: Date;
}): Promise<void> {
  const admin = createAdminClient();
  if (await lastTextWasAboutMoney(admin, p.tenantId, p.threadId, p.now)) {
    await classifyPaymentAndAct(admin, p);
    return;
  }
  const classification =
    p.keyword === 'said_no'
      ? { intent: 'said_no' as const, proposedDate: null, confidence: 1, source: 'keyword' as const }
      : await classifyReply(admin, {
          tenantId: p.tenantId,
          messageId: p.messageId,
          body: p.body,
          today: todayInLondon(p.now),
          visitDate: await visitDateFor(admin, p.tenantId, p.boundJobIds),
          businessName: await businessNameFor(admin, p.tenantId),
        });

  const { error } = await admin
    .from('messages')
    .update({
      classification: classification.intent,
      classification_confidence: classification.confidence,
      requested_date: classification.proposedDate,
    })
    .eq('id', p.messageId)
    .eq('tenant_id', p.tenantId);
  if (error) throw new Error(error.message);

  const reason = attentionReason(classification.intent);
  const { error: noteError } = await admin.rpc('messaging_note_inbound', {
    p_thread_id: p.threadId,
    p_needs_attention: reason != null,
    p_reason: reason,
  });
  if (noteError) throw new Error(noteError.message);

  if (classification.intent !== 'other') {
    await applyReplyOutcome(admin, {
      tenantId: p.tenantId,
      threadId: p.threadId,
      customerId: p.customerId,
      messageId: p.messageId,
      intent: classification.intent,
      proposedDate: classification.proposedDate,
      boundJobIds: p.boundJobIds,
      body: p.body,
    });
  }
}

export async function handleInboundText(
  event: InboundEvent,
  now?: Date,
): Promise<{ outcome: InboundOutcome; messageId?: string }> {
  const at = now ?? new Date();
  if (!isE164(event.from)) {
    console.info('[handleInboundText] ignore', maskPhone(event.from));
    return { outcome: 'recorded' };
  }

  const admin = createAdminClient();
  const keyword = matchKeyword(event.body);
  if (keyword === 'opt_out') {
    await recordOptOut(admin, event.from, normaliseReply(event.body));
  } else if (keyword === 'opt_in') {
    await recordOptIn(admin, event.from);
  }

  const messageKey = providerMessageId(event.providerMessageId);
  const seen = messageKey ? await alreadyStored(admin, messageKey) : false;
  if (!seen) {
    const counted = await admin.rpc('messaging_count_inbound', {
      p_phone: event.from,
      p_limit: 10,
    });
    if (counted.error) throw new Error(counted.error.message);
    const count = countRow(counted.data);
    if (count?.isBlocked) return { outcome: 'blocked' };
  }

  const route = await routeInbound(admin, event.from, at);
  const body = clipBody(event.body);

  if (route.kind === 'unknown') {
    const leadReply = await handleLeadReply(admin, {
      from: event.from,
      body,
      providerMessageId: messageKey,
      keyword: keyword === 'opt_out' || keyword === 'opt_in' ? keyword : null,
      at,
    });
    if (leadReply.handled) {
      return { outcome: leadReply.duplicate ? 'duplicate' : 'lead_reply' };
    }

    const { data, error } = await admin
      .from('messaging_unrouted_inbound')
      .insert({
        from_address: event.from,
        body,
        provider: PROVIDER,
        provider_message_id: messageKey,
      })
      .select('id')
      .single();
    if (error) {
      if (isUniqueViolation(error)) return { outcome: 'duplicate' };
      throw new Error(error.message);
    }
    const unroutedId = asId(asRecord(data)?.id);
    if (!unroutedId) throw new Error('Could not store the unrouted text');
    if (keyword === 'opt_out') return { outcome: 'opt_out' };
    if (keyword === 'opt_in') return { outcome: 'opt_in' };

    const claim = await admin.rpc('messaging_claim_autoreply', {
      p_phone: event.from,
    });
    if (claim.error || claim.data !== true) {
      if (claim.error) console.error('[handleInboundText] autoreply', claim.error.message);
      return { outcome: 'unknown_stored' };
    }

    const sent = await sendPlatformText({
      to: event.from,
      body: UNKNOWN_NUMBER_SMS,
      reference: unroutedId,
    });
    if (!sent.ok) {
      if (sent.error) console.error('[handleInboundText] platform text', sent.error);
      return { outcome: 'unknown_stored' };
    }
    const { error: stampError } = await admin
      .from('messaging_unrouted_inbound')
      .update({ autoreplied: true })
      .eq('id', unroutedId);
    if (stampError) console.error('[handleInboundText] autoreplied', stampError.message);
    return { outcome: 'unknown_autoreplied' };
  }

  const { data, error } = await admin
    .from('messages')
    .insert({
      tenant_id: route.tenantId,
      thread_id: route.threadId,
      customer_id: route.customerId,
      direction: 'inbound',
      channel: 'sms',
      kind: 'inbound',
      status: 'received',
      body,
      from_address: event.from,
      to_address: event.to,
      provider: PROVIDER,
      provider_message_id: messageKey,
      job_id: route.boundJobIds[0] ?? null,
      job_ids: route.boundJobIds,
      classification:
        keyword === 'opt_out' ? 'opt_out' : keyword === 'opt_in' ? 'opt_in' : null,
    })
    .select('id')
    .single();
  if (error) {
    if (isUniqueViolation(error)) return { outcome: 'duplicate' };
    throw new Error(error.message);
  }
  const messageId = asId(asRecord(data)?.id);
  if (!messageId) throw new Error('Could not store the text');

  if (keyword === 'opt_out' || keyword === 'opt_in') {
    const { error: noteError } = await admin.rpc('messaging_note_inbound', {
      p_thread_id: route.threadId,
      p_needs_attention: false,
      p_reason: null,
    });
    if (noteError) logFailure('handleInboundText', noteError.message);
    return {
      outcome: keyword === 'opt_out' ? 'opt_out' : 'opt_in',
      messageId,
    };
  }

  try {
    await classifyAndAct({
      tenantId: route.tenantId,
      threadId: route.threadId,
      customerId: route.customerId,
      messageId,
      body,
      boundJobIds: route.boundJobIds,
      keyword,
      now: at,
    });
  } catch (err) {
    logFailure('handleInboundText', err);
    const { error: noteError } = await admin.rpc('messaging_note_inbound', {
      p_thread_id: route.threadId,
      p_needs_attention: true,
      p_reason: 'Sent a message',
    });
    if (noteError) logFailure('handleInboundText', noteError.message);
  }
  return { outcome: 'recorded', messageId };
}
