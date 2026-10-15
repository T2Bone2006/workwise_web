import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { composeRefund } from '@/lib/direct-debit/messages';
import { customerEmailFrom, emailDocument } from '@/lib/emails/visit-done';
import { getTenantMessagingContext } from '@/lib/messaging/brand';
import { sendCustomerMessage } from '@/lib/messaging/send';

type Row = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Tell the customer a refund made in WorkWise is on its way. Safe to call twice
 * (message dedupe key `refund:<refundId>`). Never throws.
 */
export async function afterRefundCreated(
  admin: SupabaseClient,
  p: { tenantId: string; paymentId: string; refundId: string; amount: number },
): Promise<void> {
  try {
    const { data: payment } = await admin
      .from('payments')
      .select('customer_id')
      .eq('id', p.paymentId)
      .eq('tenant_id', p.tenantId)
      .maybeSingle();
    const customerId = str((payment as Row | null)?.customer_id);
    if (!customerId) return;

    const [{ data: customerData }, ctx] = await Promise.all([
      admin.from('customers').select('name, email').eq('id', customerId).eq('tenant_id', p.tenantId).maybeSingle(),
      getTenantMessagingContext(admin, p.tenantId),
    ]);
    const customer = customerData as Row | null;
    if (!customer || !ctx) {
      console.error('[refund] no message: missing customer or business', p.refundId);
      return;
    }

    const message = composeRefund({
      businessName: ctx.businessName,
      customerName: str(customer.name) ?? '',
      amount: p.amount,
      contactPhone: ctx.contactPhone,
    });
    const customerEmail = str(customer.email);
    const signOff = `Thanks,\n${ctx.businessName}`;

    const outcome = await sendCustomerMessage({
      tenantId: p.tenantId,
      customerId,
      kind: 'refund',
      dedupeKey: `refund:${p.refundId}`,
      text: () => message.sms,
      email: customerEmail
        ? async () => {
            const html = emailDocument({
              subject: message.subject,
              brand: { businessName: ctx.businessName, logoUrl: ctx.logoUrl },
              greeting: message.greeting,
              paragraphs: message.emailParagraphs,
              payUrl: null,
              payLabel: null,
              bankLine: null,
              signOff,
            });
            const text = [message.greeting, '', ...message.emailParagraphs, '', signOff].join('\n');
            try {
              const { resend } = await import('@/lib/resend');
              const { error } = await resend.emails.send({
                from: customerEmailFrom(ctx.businessName),
                to: customerEmail,
                subject: message.subject,
                html,
                text,
                ...(ctx.replyToEmail ? { replyTo: ctx.replyToEmail } : {}),
              });
              if (error) return { sent: false, error: error.message };
              return { sent: true };
            } catch (err) {
              return { sent: false, error: err instanceof Error ? err.message : String(err) };
            }
          }
        : null,
    });
    if (outcome.outcome === 'failed') console.error('[refund] message', outcome.error);
  } catch (err) {
    console.error('[refund]', p.refundId, err instanceof Error ? err.message : 'error');
  }
}
