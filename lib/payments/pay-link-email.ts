import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getCustomerBalance } from '@/lib/data/payments/owed';
import { getPaymentSettings, hasBankDetails } from '@/lib/data/payments/settings';
import { composeShareMessage } from '@/lib/payments/messages';
import { ensurePayLinkToken, ensurePaymentReference } from '@/lib/payments/money-core';
import { payLinkUrl } from '@/lib/payments/tokens';

/**
 * Emails a customer their pay link with the same wording as Share (the phone's
 * POST /api/rounds/customers/[id]/pay-link does the same steps). Used by the
 * assistant's "send pay link" action.
 */
export async function emailPayLinkCore(
  supabase: SupabaseClient,
  p: { tenantId: string; customerId: string },
): Promise<{ sent: true; to: string } | { sent: false; error: string }> {
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('name, email')
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  if (customerError || !customer) return { sent: false, error: 'Customer not found.' };
  const row = customer as { name?: unknown; email?: unknown };
  const to = typeof row.email === 'string' ? row.email.trim() : '';
  if (!to) return { sent: false, error: 'No email address for this customer' };

  const reference = await ensurePaymentReference(supabase, { tenantId: p.tenantId, customerId: p.customerId });
  const token = await ensurePayLinkToken(supabase, { tenantId: p.tenantId, customerId: p.customerId });
  if (!token) return { sent: false, error: 'Could not create a pay link.' };

  let url: string;
  try {
    url = payLinkUrl(token);
  } catch {
    return { sent: false, error: 'Pay links are not configured.' };
  }

  const [balance, settings, tenantResult] = await Promise.all([
    getCustomerBalance(supabase, p.tenantId, p.customerId),
    getPaymentSettings(supabase, p.tenantId),
    supabase.from('tenants').select('name, settings').eq('id', p.tenantId).maybeSingle(),
  ]);
  const tenant = tenantResult.data as { name?: unknown; settings?: unknown } | null;
  const businessName = typeof tenant?.name === 'string' ? tenant.name : '';
  const bank = hasBankDetails(settings)
    ? {
        accountName: settings.bankAccountName as string,
        sortCode: settings.bankSortCode as string,
        accountNumber: settings.bankAccountNumber as string,
      }
    : null;

  const shareMessage = composeShareMessage({
    businessName,
    customerName: typeof row.name === 'string' ? row.name : '',
    owedTotal: balance.owedAmount,
    unpaidVisits: balance.unpaidVisitCount,
    payUrl: url,
    bank,
    reference,
  });

  const { sendPayLinkEmail } = await import('@/lib/payments/notify');
  const sent = await sendPayLinkEmail(supabase, {
    tenantId: p.tenantId,
    to,
    businessName: businessName || 'Your cleaner',
    shareMessage,
    payUrl: url,
    tenantSettings: tenant?.settings ?? null,
  });
  if (!sent.sent) return { sent: false, error: sent.error ?? 'Could not send the email.' };
  return { sent: true, to };
}
