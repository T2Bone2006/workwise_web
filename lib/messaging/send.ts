import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getTenantMessagingContext } from '@/lib/messaging/brand';
import {
  channelOrderFor,
  type Channel,
  type MessageKind,
} from '@/lib/messaging/channel';
import { TEXT_ALLOWANCE_PER_MONTH } from '@/lib/messaging/credits';
import { sendEmailFallbackForMessage } from '@/lib/messaging/email-fallback';
import { countSegments } from '@/lib/messaging/gsm';
import {
  isQuietHours,
  londonMonth,
  sendableFrom,
} from '@/lib/messaging/london-time';
import { isUkMobileE164, maskPhone } from '@/lib/messaging/phone';
import {
  activeProvider,
  ourNumber,
  sendText,
} from '@/lib/messaging/provider';
import {
  bindThreadToStop,
  ensureThread,
  isOptedOut,
} from '@/lib/messaging/threads';
import { listRoundsTenantIds } from '@/lib/messaging/rounds-tenants';
import { createAdminClient } from '@/lib/supabase/admin';

export type EmailAttempt = () => Promise<{ sent: boolean; error?: string }>;
export type SendCustomerMessageInput = {
  tenantId: string;
  customerId: string;
  kind: MessageKind;
  dedupeKey: string; // unique per business, see table below
  text: (ctx: { firstText: boolean }) => string; // fitted, GSM-7 (from templates.ts)
  email: EmailAttempt | null; // null = no email version (reminders)
  jobIds?: string[];
  visitChangeId?: string | null;
  bindThread?: boolean; // reminders + change texts (T10)
  /** Only visit-done invoices use this (email first so the PDF goes; step 12). Never beats 'No messages'. */
  channelOrderOverride?: Channel[];
  now?: Date;
};
export type SendOutcome =
  | { outcome: 'text_sent'; messageId: string }
  | { outcome: 'text_held'; messageId: string }
  | { outcome: 'email_sent'; messageId: string }
  | { outcome: 'duplicate' }
  | {
      outcome: 'skipped';
      messageId?: string;
      reason:
        | 'no_messages'
        | 'no_channel'
        | 'opted_out'
        | 'no_texts_left'
        | 'customer_inactive';
    }
  | { outcome: 'failed'; messageId?: string; error: string };

type SkipReason = 'opted_out' | 'no_texts_left' | 'no_channel';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function preferSkipReason(
  current: SkipReason | null,
  next: SkipReason,
): SkipReason {
  const rank: Record<SkipReason, number> = {
    opted_out: 3,
    no_texts_left: 2,
    no_channel: 1,
  };
  if (current == null || rank[next] > rank[current]) return next;
  return current;
}

async function refundCredits(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    segments: number;
    from: string;
    month: string;
  },
): Promise<void> {
  if (p.from !== 'allowance' && p.from !== 'pack') return;
  const { error } = await admin.rpc('refund_text_credits', {
    p_tenant_id: p.tenantId,
    p_segments: p.segments,
    p_from: p.from,
    p_month: p.month,
  });
  if (error) {
    console.error('[sendCustomerMessage] refund', error.message);
  }
}

async function markOptIn(
  admin: SupabaseClient,
  customerId: string,
  tenantId: string,
  at: Date,
): Promise<void> {
  const { error } = await admin
    .from('customers')
    .update({ messaging_opt_in_at: at.toISOString() })
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .is('messaging_opt_in_at', null);
  if (error) {
    console.error('[sendCustomerMessage] opt_in', error.message);
  }
}

async function touchThreadOutbound(
  admin: SupabaseClient,
  p: { threadId: string; phone: string; at: Date },
): Promise<void> {
  const { error } = await admin
    .from('message_threads')
    .update({
      last_outbound_at: p.at.toISOString(),
      customer_address: p.phone,
    })
    .eq('id', p.threadId);
  if (error) {
    console.error('[sendCustomerMessage] thread outbound', error.message);
  }
}

async function markMessageFailed(
  admin: SupabaseClient,
  messageId: string,
  error: string,
): Promise<void> {
  const { error: patchError } = await admin
    .from('messages')
    .update({ status: 'failed', error })
    .eq('id', messageId);
  if (patchError) {
    console.error('[sendCustomerMessage] mark failed', patchError.message);
  }
}

/** Never throws. */
export async function sendCustomerMessage(
  input: SendCustomerMessageInput,
): Promise<SendOutcome> {
  let claimedMessageId: string | null = null;
  let admin: SupabaseClient | null = null;
  try {
    const now = input.now ?? new Date();
    admin = createAdminClient();

    const { data: customerRow, error: customerError } = await admin
      .from('customers')
      .select(
        'id, tenant_id, name, email, phone_e164, preferred_channel, messaging_opt_in_at, is_active',
      )
      .eq('id', input.customerId)
      .eq('tenant_id', input.tenantId)
      .maybeSingle();

    if (customerError || !customerRow) {
      return {
        outcome: 'failed',
        error: customerError?.message ?? 'Customer not found',
      };
    }

    const customer = customerRow as {
      id: string;
      tenant_id: string;
      name: string | null;
      email: string | null;
      phone_e164: string | null;
      preferred_channel: string | null;
      messaging_opt_in_at: string | null;
      is_active: boolean | null;
    };

    if (customer.is_active === false) {
      return { outcome: 'skipped', reason: 'customer_inactive' };
    }

    const ctx = await getTenantMessagingContext(admin, input.tenantId);
    if (!ctx) {
      return { outcome: 'failed', error: 'Tenant not found' };
    }

    let order = channelOrderFor(
      input.kind,
      customer.preferred_channel as
        | 'sms'
        | 'whatsapp'
        | 'email'
        | 'none'
        | null,
      ctx.settings,
    );
    if (order.length > 0 && input.channelOrderOverride) {
      order = input.channelOrderOverride;
    }
    if (order.length === 0) {
      return { outcome: 'skipped', reason: 'no_messages' };
    }

    const phone = customer.phone_e164;
    const threadId = await ensureThread(admin, {
      tenantId: input.tenantId,
      customerId: input.customerId,
      phone,
    });

    const jobIds = input.jobIds ?? [];
    const { data: claimed, error: claimError } = await admin
      .from('messages')
      .insert({
        tenant_id: input.tenantId,
        thread_id: threadId,
        customer_id: input.customerId,
        direction: 'outbound',
        channel: order[0] === 'email' ? 'email' : 'sms',
        kind: input.kind,
        body: '',
        dedupe_key: input.dedupeKey,
        status: 'queued',
        job_id: jobIds[0] ?? null,
        job_ids: jobIds,
        visit_change_id: input.visitChangeId ?? null,
      })
      .select('id')
      .single();

    if (claimError) {
      if (isUniqueViolation(claimError)) {
        return { outcome: 'duplicate' };
      }
      return { outcome: 'failed', error: claimError.message };
    }

    const messageId = asString((claimed as { id?: unknown } | null)?.id);
    if (!messageId) {
      return { outcome: 'failed', error: 'Could not claim message row' };
    }
    claimedMessageId = messageId;

    let skipReason: SkipReason | null = null;
    let lastTextError: string | null = null;

    for (const channel of order) {
      if (channel === 'text') {
        if (!isUkMobileE164(phone)) {
          skipReason = preferSkipReason(skipReason, 'no_channel');
          continue;
        }
        if (await isOptedOut(admin, phone)) {
          skipReason = preferSkipReason(skipReason, 'opted_out');
          continue;
        }

        const firstText = customer.messaging_opt_in_at == null;
        const body = input.text({ firstText });
        const segments = countSegments(body).segments;
        const month = londonMonth(now);

        const { data: billedFrom, error: creditError } = await admin.rpc(
          'claim_text_credits',
          {
            p_tenant_id: input.tenantId,
            p_segments: segments,
            p_allowance: TEXT_ALLOWANCE_PER_MONTH,
          },
        );

        if (creditError) {
          // Skip text and try email — don't leave the claim stuck on a credit RPC blip.
          lastTextError = creditError.message;
          continue;
        }

        const from =
          typeof billedFrom === 'string' ? billedFrom : String(billedFrom ?? '');
        if (from === 'none') {
          skipReason = preferSkipReason(skipReason, 'no_texts_left');
          continue;
        }

        if (isQuietHours(now)) {
          const holdUntil = sendableFrom(now);
          const { error: holdError } = await admin
            .from('messages')
            .update({
              channel: 'sms',
              status: 'held',
              hold_until: holdUntil.toISOString(),
              body,
              to_address: phone,
              from_address: ourNumber(),
              segments,
              billed_from: from,
              billed_month: month,
              provider: activeProvider(),
            })
            .eq('id', messageId);
          if (holdError) {
            await refundCredits(admin, {
              tenantId: input.tenantId,
              segments,
              from,
              month,
            });
            return {
              outcome: 'failed',
              messageId,
              error: holdError.message,
            };
          }
          if (input.bindThread && jobIds.length > 0) {
            await bindThreadToStop(admin, {
              threadId,
              jobIds,
              at: now,
            });
          }
          return { outcome: 'text_held', messageId };
        }

        const sent = await sendText({
          to: phone,
          body,
          clientReference: messageId,
        });

        if (sent.ok) {
          const { error: sentError } = await admin
            .from('messages')
            .update({
              channel: 'sms',
              status: 'sent',
              sent_at: now.toISOString(),
              provider: sent.provider,
              provider_message_id: sent.providerMessageId,
              body,
              to_address: phone,
              from_address: ourNumber(),
              segments,
              billed_from: from,
              billed_month: month,
            })
            .eq('id', messageId);
          if (sentError) {
            console.error('[sendCustomerMessage] sent update', sentError.message);
          }
          await markOptIn(admin, input.customerId, input.tenantId, now);
          await touchThreadOutbound(admin, { threadId, phone, at: now });
          if (input.bindThread && jobIds.length > 0) {
            await bindThreadToStop(admin, { threadId, jobIds, at: now });
          }
          return { outcome: 'text_sent', messageId };
        }

        await refundCredits(admin, {
          tenantId: input.tenantId,
          segments,
          from,
          month,
        });
        lastTextError = sent.error;
        // Keep the text and number so the morning job can retry it
        // (retryFailedTexts). Credits were refunded above.
        const { error: failPatchError } = await admin
          .from('messages')
          .update({
            error: sent.error,
            provider_status: 'send_failed',
            provider: sent.provider,
            channel: 'sms',
            body,
            to_address: phone,
            from_address: ourNumber(),
            segments,
          })
          .eq('id', messageId);
        if (failPatchError) {
          console.error(
            '[sendCustomerMessage] send_failed patch',
            failPatchError.message,
          );
        }
        continue;
      }

      // email
      if (input.email == null || !asString(customer.email)) {
        skipReason = preferSkipReason(skipReason, 'no_channel');
        continue;
      }

      const emailResult = await input.email();
      if (emailResult.sent) {
        const emailBody = input.text({ firstText: false });
        const { error: emailPatchError } = await admin
          .from('messages')
          .update({
            channel: 'email',
            status: 'sent',
            sent_at: now.toISOString(),
            to_address: asString(customer.email),
            body: emailBody,
          })
          .eq('id', messageId);
        if (emailPatchError) {
          console.error(
            '[sendCustomerMessage] email update',
            emailPatchError.message,
          );
        }
        return { outcome: 'email_sent', messageId };
      }

      const { error: failedEmailError } = await admin
        .from('messages')
        .update({
          status: 'failed',
          error: emailResult.error ?? 'Email send failed',
        })
        .eq('id', messageId);
      if (failedEmailError) {
        console.error(
          '[sendCustomerMessage] email failed patch',
          failedEmailError.message,
        );
      }
      return {
        outcome: 'failed',
        messageId,
        error: emailResult.error ?? 'Email send failed',
      };
    }

    // A text that was attempted and refused must stay failed with the provider
    // error — a missing email must not rewrite it as skipped no_channel.
    if (lastTextError) {
      await markMessageFailed(admin, messageId, lastTextError);
      return { outcome: 'failed', messageId, error: lastTextError };
    }

    const reason = skipReason ?? 'no_channel';
    const { error: skipError } = await admin
      .from('messages')
      .update({
        status: 'skipped',
        error: reason,
      })
      .eq('id', messageId);
    if (skipError) {
      console.error('[sendCustomerMessage] skip patch', skipError.message);
    }
    return { outcome: 'skipped', messageId, reason };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(
      `[sendCustomerMessage] ${input.kind} ${input.dedupeKey} ${error}`,
    );
    if (claimedMessageId && admin) {
      await markMessageFailed(admin, claimedMessageId, error);
    }
    return {
      outcome: 'failed',
      ...(claimedMessageId ? { messageId: claimedMessageId } : {}),
      error,
    };
  }
}

/**
 * `reminder:<YYYY-MM-DD>:<jobId>` (what reminders.ts writes) or compact
 * `reminder:<YYYYMMDD>:<jobId>` → `YYYY-MM-DD`, or null if not a reminder key.
 */
function reminderDateFromDedupe(dedupeKey: string | null | undefined): string | null {
  if (typeof dedupeKey !== 'string') return null;
  const dashed = /^reminder:(\d{4}-\d{2}-\d{2}):/.exec(dedupeKey);
  if (dashed) return dashed[1]!;
  const compact = /^reminder:(\d{8}):/.exec(dedupeKey);
  if (!compact) return null;
  const raw = compact[1]!;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

async function reminderJobsStillAssigned(
  admin: SupabaseClient,
  row: {
    tenant_id: string;
    job_id: string | null;
    job_ids: string[] | null;
    dedupe_key: string | null;
  },
): Promise<boolean> {
  const ids =
    Array.isArray(row.job_ids) && row.job_ids.length > 0
      ? row.job_ids
      : row.job_id
        ? [row.job_id]
        : [];
  if (ids.length === 0) return true;

  const expectedDate = reminderDateFromDedupe(row.dedupe_key);

  const { data: jobs, error } = await admin
    .from('jobs')
    .select('id, status, scheduled_date')
    .eq('tenant_id', row.tenant_id)
    .in('id', ids);

  if (error) {
    console.error('[sendHeldMessages] jobs', error.message);
    // Fail closed: do not send a stale reminder when we cannot check.
    return false;
  }

  const list = (jobs ?? []) as {
    id: string;
    status: string;
    scheduled_date: string | null;
  }[];
  if (list.length !== ids.length) return false;
  return list.every((j) => {
    if (j.status !== 'assigned') return false;
    if (expectedDate == null) return true;
    const day =
      typeof j.scheduled_date === 'string'
        ? j.scheduled_date.slice(0, 10)
        : null;
    return day === expectedDate;
  });
}

/** Held or failed rows for a business with no entitled Rounds plan. Conditional on the
 *  status still being held or failed, so a row another runner already claimed is left alone.
 *  Does not refund. sendHeldMessages refunds a held row after this wins: those credits
 *  were taken when the text was held. A failed row already had its credits returned
 *  when the send failed, so retryFailedTexts must not refund again. */
async function skipBecausePlanEnded(
  admin: SupabaseClient,
  id: string,
  status: 'held' | 'failed',
): Promise<'skipped' | 'missed' | 'error'> {
  const { data, error } = await admin
    .from('messages')
    .update({ status: 'skipped', error: 'plan_ended' })
    .eq('id', id)
    .eq('status', status)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[plan_ended]', id, error.message);
    return 'error';
  }
  return data ? 'skipped' : 'missed';
}

/** Entitled Rounds tenants for this run. Null means the lookup failed: send nothing. */
async function entitledRoundsTenants(
  admin: SupabaseClient,
  label: string,
): Promise<Set<string> | null> {
  try {
    return new Set(await listRoundsTenantIds(admin));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${label}] tenant list`, message);
    return null;
  }
}

/** Morning cron: send every held text whose hold_until has passed (max 300 per run). Never throws. */
export async function sendHeldMessages(
  now?: Date,
): Promise<{ sent: number; emailed: number; skipped: number; failed: number }> {
  const counts = { sent: 0, emailed: 0, skipped: 0, failed: 0 };
  try {
    const at = now ?? new Date();
    const admin = createAdminClient();
    const entitled = await entitledRoundsTenants(admin, 'sendHeldMessages');
    if (!entitled) return counts;

    const { data: rows, error } = await admin
      .from('messages')
      .select(
        'id, tenant_id, thread_id, customer_id, kind, body, to_address, segments, billed_from, billed_month, job_id, job_ids, dedupe_key',
      )
      .eq('status', 'held')
      .lte('hold_until', at.toISOString())
      .order('hold_until', { ascending: true })
      .limit(300);

    if (error) {
      console.error('[sendHeldMessages]', error.message);
      return counts;
    }

    for (const raw of rows ?? []) {
      const row = raw as {
        id: string;
        tenant_id: string;
        thread_id: string;
        customer_id: string;
        kind: MessageKind;
        body: string;
        to_address: string | null;
        segments: number | null;
        billed_from: string | null;
        billed_month: string | null;
        job_id: string | null;
        job_ids: string[] | null;
        dedupe_key: string | null;
      };

      try {
        if (!entitled.has(row.tenant_id)) {
          const marked = await skipBecausePlanEnded(admin, row.id, 'held');
          if (marked === 'skipped') {
            // Credits were taken when the text was held. Only the runner that won
            // the skip refunds, so a second morning run cannot return them twice.
            if (row.segments && row.billed_from && row.billed_month) {
              await refundCredits(admin, {
                tenantId: row.tenant_id,
                segments: row.segments,
                from: row.billed_from,
                month: row.billed_month,
              });
            }
            counts.skipped += 1;
          } else if (marked === 'error') counts.failed += 1;
          continue;
        }

        // Claim held → queued so two cron runners cannot send the same text.
        const { data: claimed, error: claimError } = await admin
          .from('messages')
          .update({ status: 'queued' })
          .eq('id', row.id)
          .eq('status', 'held')
          .select('id')
          .maybeSingle();

        if (claimError) {
          console.error('[sendHeldMessages] claim', row.id, claimError.message);
          counts.failed += 1;
          continue;
        }
        if (!claimed) {
          // Another runner already took it.
          continue;
        }

        if (row.kind === 'reminder') {
          const ok = await reminderJobsStillAssigned(admin, row);
          if (!ok) {
            if (row.segments && row.billed_from && row.billed_month) {
              await refundCredits(admin, {
                tenantId: row.tenant_id,
                segments: row.segments,
                from: row.billed_from,
                month: row.billed_month,
              });
            }
            await admin
              .from('messages')
              .update({ status: 'skipped', error: 'visit_changed' })
              .eq('id', row.id);
            counts.skipped += 1;
            continue;
          }
        }

        const phone = row.to_address;
        if (!isUkMobileE164(phone)) {
          counts.failed += 1;
          await admin
            .from('messages')
            .update({ status: 'failed', error: 'no_mobile' })
            .eq('id', row.id);
          continue;
        }

        if (await isOptedOut(admin, phone)) {
          if (row.segments && row.billed_from && row.billed_month) {
            await refundCredits(admin, {
              tenantId: row.tenant_id,
              segments: row.segments,
              from: row.billed_from,
              month: row.billed_month,
            });
          }
          await admin
            .from('messages')
            .update({ status: 'skipped', error: 'opted_out' })
            .eq('id', row.id);
          counts.skipped += 1;
          continue;
        }

        const sent = await sendText({
          to: phone,
          body: row.body,
          clientReference: row.id,
        });

        if (sent.ok) {
          await admin
            .from('messages')
            .update({
              status: 'sent',
              sent_at: at.toISOString(),
              hold_until: null,
              provider: sent.provider,
              provider_message_id: sent.providerMessageId,
            })
            .eq('id', row.id);
          await markOptIn(admin, row.customer_id, row.tenant_id, at);
          await touchThreadOutbound(admin, {
            threadId: row.thread_id,
            phone,
            at,
          });
          counts.sent += 1;
          continue;
        }

        if (row.segments && row.billed_from && row.billed_month) {
          await refundCredits(admin, {
            tenantId: row.tenant_id,
            segments: row.segments,
            from: row.billed_from,
            month: row.billed_month,
          });
        }
        await admin
          .from('messages')
          .update({
            status: 'failed',
            error: sent.error,
            provider_status: 'send_failed',
            provider: sent.provider,
          })
          .eq('id', row.id);

        if (row.kind !== 'reminder') {
          const fallback = await sendEmailFallbackForMessage(admin, row.id);
          if (fallback.sent) counts.emailed += 1;
          else counts.failed += 1;
        } else {
          counts.failed += 1;
        }
      } catch (err) {
        counts.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[sendHeldMessages] ${row.id} ${maskPhone(row.to_address)} ${message}`,
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sendHeldMessages]', message);
  }
  return counts;
}

/** provider_status after each failed try; the last one is final. */
const RETRY_STAGES = ['send_failed', 'retry_1_failed', 'retry_2_failed'] as const;
const RETRY_WINDOW_MS = 36 * 60 * 60 * 1000;

/**
 * Morning cron: retry texts that failed to send (PureSMS down, a network
 * blip) — up to two more tries, one per morning. A reminder is only resent
 * while its visit is still on that day; STOP and running out of texts are
 * checked again. After the last try the conversation goes to Needs attention
 * so the trader knows. Never throws.
 */
export async function retryFailedTexts(
  now?: Date,
): Promise<{ sent: number; skipped: number; failed: number; gaveUp: number }> {
  const counts = { sent: 0, skipped: 0, failed: 0, gaveUp: 0 };
  try {
    const at = now ?? new Date();
    const admin = createAdminClient();
    const entitled = await entitledRoundsTenants(admin, 'retryFailedTexts');
    if (!entitled) return counts;

    const { data: rows, error } = await admin
      .from('messages')
      .select(
        'id, tenant_id, thread_id, customer_id, kind, body, to_address, segments, job_id, job_ids, dedupe_key, provider_status',
      )
      .eq('direction', 'outbound')
      .eq('channel', 'sms')
      .eq('status', 'failed')
      .in('provider_status', ['send_failed', 'retry_1_failed'])
      .gte('created_at', new Date(at.getTime() - RETRY_WINDOW_MS * 2).toISOString())
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) {
      console.error('[retryFailedTexts]', error.message);
      return counts;
    }

    for (const raw of rows ?? []) {
      const row = raw as {
        id: string;
        tenant_id: string;
        thread_id: string;
        customer_id: string;
        kind: MessageKind;
        body: string | null;
        to_address: string | null;
        segments: number | null;
        job_id: string | null;
        job_ids: string[] | null;
        dedupe_key: string | null;
        provider_status: string;
      };
      try {
        if (!entitled.has(row.tenant_id)) {
          const marked = await skipBecausePlanEnded(admin, row.id, 'failed');
          if (marked === 'skipped') counts.skipped += 1;
          else if (marked === 'error') counts.failed += 1;
          continue;
        }

        // Rows from before this change have no text saved; nothing to resend.
        if (!row.body || !isUkMobileE164(row.to_address)) continue;
        const stage = RETRY_STAGES.indexOf(row.provider_status as (typeof RETRY_STAGES)[number]);
        if (stage < 0 || stage >= RETRY_STAGES.length - 1) continue;
        const nextStage = RETRY_STAGES[stage + 1]!;

        // Claim failed → queued so two runners cannot resend the same text.
        const { data: claimed, error: claimError } = await admin
          .from('messages')
          .update({ status: 'queued' })
          .eq('id', row.id)
          .eq('status', 'failed')
          .eq('provider_status', row.provider_status)
          .select('id')
          .maybeSingle();
        if (claimError || !claimed) continue;

        const skip = async (reason: string) => {
          await admin
            .from('messages')
            .update({ status: 'skipped', error: reason })
            .eq('id', row.id);
          counts.skipped += 1;
        };

        if (row.kind === 'reminder' && !(await reminderJobsStillAssigned(admin, row))) {
          await skip('visit_changed');
          continue;
        }
        const phone = row.to_address as string;
        if (await isOptedOut(admin, phone)) {
          await skip('opted_out');
          continue;
        }

        const segments = row.segments ?? countSegments(row.body).segments;
        const month = londonMonth(at);
        const { data: billedFrom, error: creditError } = await admin.rpc('claim_text_credits', {
          p_tenant_id: row.tenant_id,
          p_segments: segments,
          p_allowance: TEXT_ALLOWANCE_PER_MONTH,
        });
        const from = typeof billedFrom === 'string' ? billedFrom : String(billedFrom ?? '');
        if (creditError || from === 'none') {
          // Put it back as it was; tomorrow's run tries again.
          await admin
            .from('messages')
            .update({ status: 'failed', error: creditError?.message ?? 'no_texts_left' })
            .eq('id', row.id);
          counts.failed += 1;
          continue;
        }

        const sent = await sendText({ to: phone, body: row.body, clientReference: row.id });
        if (sent.ok) {
          await admin
            .from('messages')
            .update({
              status: 'sent',
              sent_at: at.toISOString(),
              error: null,
              provider_status: null,
              provider: sent.provider,
              provider_message_id: sent.providerMessageId,
              segments,
              billed_from: from,
              billed_month: month,
            })
            .eq('id', row.id);
          await markOptIn(admin, row.customer_id, row.tenant_id, at);
          await touchThreadOutbound(admin, { threadId: row.thread_id, phone, at });
          counts.sent += 1;
          continue;
        }

        await refundCredits(admin, { tenantId: row.tenant_id, segments, from, month });
        await admin
          .from('messages')
          .update({ status: 'failed', error: sent.error, provider_status: nextStage })
          .eq('id', row.id);
        counts.failed += 1;

        if (nextStage === RETRY_STAGES[RETRY_STAGES.length - 1]) {
          counts.gaveUp += 1;
          const { error: threadError } = await admin
            .from('message_threads')
            .update({
              status: 'needs_attention',
              needs_attention_reason: "A text couldn't be sent",
            })
            .eq('id', row.thread_id);
          if (threadError) {
            console.error('[retryFailedTexts] needs attention', threadError.message);
          }
        }
      } catch (err) {
        counts.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[retryFailedTexts] ${row.id} ${maskPhone(row.to_address)} ${message}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[retryFailedTexts]', message);
  }
  return counts;
}

/** WorkWise's own text (no business, no credits, no messages row). Only for the unknown-number reply. Never throws. */
export async function sendPlatformText(p: {
  to: string;
  body: string;
  reference: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const sent = await sendText({
      to: p.to,
      body: p.body,
      clientReference: p.reference,
    });
    if (!sent.ok) return { ok: false, error: sent.error };
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'send failed';
    console.error('[sendPlatformText]', error);
    return { ok: false, error };
  }
}
