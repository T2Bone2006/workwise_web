import { z } from 'zod';
import { getCustomerBalance } from '@/lib/data/payments/owed';
import { getPaymentSettings, hasBankDetails } from '@/lib/data/payments/settings';
import {
  moneyErrorStatus,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { composeShareMessage } from '@/lib/payments/messages';
import {
  ensurePayLinkToken,
  ensurePaymentReference,
} from '@/lib/payments/money-core';
import { payLinkUrl } from '@/lib/payments/tokens';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const id = z.string().uuid().safeParse(rawId);
  if (!id.success) {
    return roundsJson({ error: 'Invalid customer' }, 400);
  }

  const { data: customer, error: customerError } = await auth.ctx.supabase
    .from('customers')
    .select('name')
    .eq('id', id.data)
    .eq('tenant_id', auth.ctx.tenantId)
    .maybeSingle();

  if (customerError || !customer) {
    return roundsJson({ error: 'Customer not found.' }, moneyErrorStatus('Customer not found.'));
  }

  const reference = await ensurePaymentReference(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    customerId: id.data,
  });
  const token = await ensurePayLinkToken(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    customerId: id.data,
  });
  if (!token) {
    return roundsJson({ error: 'Could not create a pay link.' }, 400);
  }

  let url: string;
  try {
    url = payLinkUrl(token);
  } catch (err) {
    console.error('pay link url', err);
    return roundsJson({ error: 'Pay links are not configured.' }, 400);
  }

  const [balance, settings, tenantResult] = await Promise.all([
    getCustomerBalance(auth.ctx.supabase, auth.ctx.tenantId, id.data),
    getPaymentSettings(auth.ctx.supabase, auth.ctx.tenantId),
    auth.ctx.supabase.from('tenants').select('name').eq('id', auth.ctx.tenantId).maybeSingle(),
  ]);

  const businessName =
    typeof (tenantResult.data as { name?: unknown } | null)?.name === 'string'
      ? (tenantResult.data as { name: string }).name
      : '';
  const customerName =
    typeof (customer as { name?: unknown }).name === 'string'
      ? (customer as { name: string }).name
      : '';

  const bank = hasBankDetails(settings)
    ? {
        accountName: settings.bankAccountName as string,
        sortCode: settings.bankSortCode as string,
        accountNumber: settings.bankAccountNumber as string,
      }
    : null;

  const shareMessage = composeShareMessage({
    businessName,
    customerName,
    owedTotal: balance.owedAmount,
    unpaidVisits: balance.unpaidVisitCount,
    payUrl: url,
    bank,
    reference,
  });

  return roundsJson({
    url,
    reference,
    shareMessage,
    owedAmount: balance.owedAmount,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const id = z.string().uuid().safeParse(rawId);
  if (!id.success) {
    return roundsJson({ error: 'Invalid customer' }, 400);
  }

  let body: { to?: unknown } = {};
  try {
    body = (await request.json()) as { to?: unknown };
  } catch {
    body = {};
  }
  const toRaw = typeof body.to === 'string' ? body.to.trim() : '';

  const { data: customer, error: customerError } = await auth.ctx.supabase
    .from('customers')
    .select('name, email')
    .eq('id', id.data)
    .eq('tenant_id', auth.ctx.tenantId)
    .maybeSingle();

  if (customerError || !customer) {
    return roundsJson({ error: 'Customer not found.' }, moneyErrorStatus('Customer not found.'));
  }

  const stored =
    typeof (customer as { email?: unknown }).email === 'string'
      ? (customer as { email: string }).email.trim()
      : '';
  const to = toRaw || stored;
  if (!to) {
    return roundsJson({ error: 'No email address for this customer' }, 400);
  }
  if (toRaw !== '' && !z.string().email().safeParse(to).success) {
    return roundsJson({ error: 'That email address looks wrong.' }, 400);
  }

  const reference = await ensurePaymentReference(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    customerId: id.data,
  });
  const token = await ensurePayLinkToken(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    customerId: id.data,
  });
  if (!token) {
    return roundsJson({ error: 'Could not create a pay link.' }, 400);
  }

  let url: string;
  try {
    url = payLinkUrl(token);
  } catch {
    return roundsJson({ error: 'Pay links are not configured.' }, 400);
  }

  const [balance, settings, tenantResult] = await Promise.all([
    getCustomerBalance(auth.ctx.supabase, auth.ctx.tenantId, id.data),
    getPaymentSettings(auth.ctx.supabase, auth.ctx.tenantId),
    auth.ctx.supabase
      .from('tenants')
      .select('name, settings')
      .eq('id', auth.ctx.tenantId)
      .maybeSingle(),
  ]);

  const businessName =
    typeof (tenantResult.data as { name?: unknown } | null)?.name === 'string'
      ? (tenantResult.data as { name: string }).name
      : '';
  const customerName =
    typeof (customer as { name?: unknown }).name === 'string'
      ? (customer as { name: string }).name
      : '';

  const bank = hasBankDetails(settings)
    ? {
        accountName: settings.bankAccountName as string,
        sortCode: settings.bankSortCode as string,
        accountNumber: settings.bankAccountNumber as string,
      }
    : null;

  const shareMessage = composeShareMessage({
    businessName,
    customerName,
    owedTotal: balance.owedAmount,
    unpaidVisits: balance.unpaidVisitCount,
    payUrl: url,
    bank,
    reference,
  });

  const { sendPayLinkEmail } = await import('@/lib/payments/notify');
  const sent = await sendPayLinkEmail(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    to,
    businessName: businessName || 'Your cleaner',
    shareMessage,
    payUrl: url,
    tenantSettings: (tenantResult.data as { settings?: unknown } | null)?.settings ?? null,
  });
  if (!sent.sent) {
    return roundsJson({ error: sent.error ?? 'Could not send the email.' }, 400);
  }

  return roundsJson({ emailed: true, to });
}
