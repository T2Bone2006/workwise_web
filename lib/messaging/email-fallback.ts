import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getTenantMessagingContext } from '@/lib/messaging/brand';
import type { MessageKind } from '@/lib/messaging/channel';
import { buildPlainCustomerEmail } from '@/lib/emails/plain-customer';
import {
  customerEmailFrom,
  sendVisitDoneEmailFallback,
} from '@/lib/payments/notify';

export const FALLBACK_SUBJECTS: Record<MessageKind, (biz: string) => string> = {
  visit_done: (biz) => `${biz}: your visit`,
  chaser: (biz) => `${biz}: payment reminder`,
  payment_received: (biz) => `Thanks for your payment — ${biz}`,
  visit_change: (biz) => `${biz}: change to your visit`,
  reply_ack: (biz) => `${biz}: change to your visit`,
  // Never used — reminders have no email fallback.
  reminder: (biz) => `${biz}: reminder`,
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Send the email version of a message row whose text could not be delivered. Never throws. */
export async function sendEmailFallbackForMessage(
  admin: SupabaseClient,
  messageId: string,
): Promise<{ sent: boolean; error?: string }> {
  try {
    const { data: row, error: rowError } = await admin
      .from('messages')
      .select(
        'id, tenant_id, customer_id, kind, body, job_id, job_ids, email_fallback_at',
      )
      .eq('id', messageId)
      .maybeSingle();

    if (rowError || !row) {
      return { sent: false, error: rowError?.message ?? 'Message not found' };
    }

    const message = row as {
      id: string;
      tenant_id: string;
      customer_id: string;
      kind: MessageKind;
      body: string;
      job_id: string | null;
      job_ids: string[] | null;
      email_fallback_at: string | null;
    };

    if (message.kind === 'reminder') return { sent: false };

    const { data: customer, error: customerError } = await admin
      .from('customers')
      .select('email')
      .eq('id', message.customer_id)
      .eq('tenant_id', message.tenant_id)
      .maybeSingle();

    if (customerError || !customer) {
      return {
        sent: false,
        error: customerError?.message ?? 'Customer not found',
      };
    }

    const email = asString((customer as { email?: unknown }).email);
    if (!email) return { sent: false };

    const ctx = await getTenantMessagingContext(admin, message.tenant_id);
    if (!ctx) return { sent: false, error: 'Tenant not found' };

    // Claim the fallback slot first so two concurrent failures can't double-email.
    const stamp = new Date().toISOString();
    const { data: claimed, error: claimError } = await admin
      .from('messages')
      .update({ email_fallback_at: stamp })
      .eq('id', messageId)
      .is('email_fallback_at', null)
      .select('id')
      .maybeSingle();

    if (claimError) {
      return { sent: false, error: claimError.message };
    }
    if (!claimed) {
      return { sent: false };
    }

    if (message.kind === 'visit_done') {
      if (!message.job_id) {
        await admin
          .from('messages')
          .update({ email_fallback_at: null })
          .eq('id', messageId);
        return { sent: false, error: 'Visit not found' };
      }
      const result = await sendVisitDoneEmailFallback(admin, {
        tenantId: message.tenant_id,
        jobId: message.job_id,
        jobIds: Array.isArray(message.job_ids) ? message.job_ids : undefined,
      });
      if (!result.sent) {
        await admin
          .from('messages')
          .update({ email_fallback_at: null })
          .eq('id', messageId);
      }
      return result;
    }

    const subject = FALLBACK_SUBJECTS[message.kind](ctx.businessName);
    const built = buildPlainCustomerEmail({
      businessName: ctx.businessName,
      logoUrl: ctx.logoUrl,
      subject,
      text: message.body,
    });

    try {
      const { resend } = await import('@/lib/resend');
      const { error } = await resend.emails.send({
        from: customerEmailFrom(ctx.businessName),
        to: email,
        subject: built.subject,
        html: built.html,
        text: built.text,
        ...(ctx.replyToEmail ? { replyTo: ctx.replyToEmail } : {}),
      });

      if (error) {
        await admin
          .from('messages')
          .update({ email_fallback_at: null })
          .eq('id', messageId);
        console.error('[sendEmailFallbackForMessage]', messageId, error.message);
        return { sent: false, error: error.message };
      }

      return { sent: true };
    } catch (sendErr) {
      await admin
        .from('messages')
        .update({ email_fallback_at: null })
        .eq('id', messageId);
      const error = sendErr instanceof Error ? sendErr.message : String(sendErr);
      console.error('[sendEmailFallbackForMessage]', messageId, error);
      return { sent: false, error };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[sendEmailFallbackForMessage]', messageId, error);
    return { sent: false, error };
  }
}
