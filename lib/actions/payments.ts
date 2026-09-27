'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getCustomerBalance } from '@/lib/data/payments/owed';
import { getPaymentSettings, hasBankDetails } from '@/lib/data/payments/settings';
import {
  ensurePayLinkToken,
  ensurePaymentReference,
  recordPaymentCore,
  setVisitWaivedCore,
  voidPaymentCore,
} from '@/lib/payments/money-core';
import { createInvoiceCore, voidInvoiceCore } from '@/lib/invoices/invoice-core';
import { composeShareMessage } from '@/lib/payments/messages';
import { afterManualPayment, sendInvoiceEmail } from '@/lib/payments/notify';
import { payLinkUrl } from '@/lib/payments/tokens';
import {
  recordPaymentSchema,
  voidPaymentSchema,
  waiveVisitSchema,
  type RecordPaymentInput,
  type VoidPaymentInput,
  type WaiveVisitInput,
} from '@/lib/validations/payments';

export type ActionResult = { success: true } | { success: false; error: string };

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}

function revalidateMoney(customerId?: string | null) {
  revalidatePath('/payments');
  revalidatePath('/dashboard');
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

async function requireRounds(): Promise<
  | {
      success: true;
      tenantId: string;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string | null;
    }
  | { success: false; error: string }
> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not signed in' };

  const products = await getTenantProducts();
  if (!products.hasRounds) {
    return { success: false, error: 'Payments are part of Rounds.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { success: true, tenantId, supabase, userId: user?.id ?? null };
}

export async function recordPayment(
  input: RecordPaymentInput,
): Promise<ActionResult & { paymentId?: string }> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const result = await recordPaymentCore(ctx.supabase, {
    tenantId: ctx.tenantId,
    customerId: parsed.data.customerId,
    amount: parsed.data.amount,
    method: parsed.data.method,
    receivedAt: parsed.data.receivedAt,
    note: parsed.data.note,
    appliesToJobId: parsed.data.appliesToJobId,
    invoiceId: parsed.data.invoiceId,
    clientMutationId: parsed.data.clientMutationId,
    userId: ctx.userId,
  });
  if (!result.success) return result;

  await afterManualPayment(ctx.supabase, {
    tenantId: ctx.tenantId,
    paymentId: result.paymentId,
    duplicate: result.duplicate,
  });

  revalidateMoney(parsed.data.customerId);
  return { success: true, paymentId: result.paymentId };
}

export async function voidPayment(input: VoidPaymentInput): Promise<ActionResult> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const parsed = voidPaymentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const result = await voidPaymentCore(ctx.supabase, {
    tenantId: ctx.tenantId,
    paymentId: parsed.data.paymentId,
    reason: parsed.data.reason,
    userId: ctx.userId,
  });
  if (!result.success) return result;

  const { data: payment } = await ctx.supabase
    .from('payments')
    .select('customer_id')
    .eq('id', parsed.data.paymentId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  const customerId =
    payment && typeof (payment as { customer_id?: unknown }).customer_id === 'string'
      ? (payment as { customer_id: string }).customer_id
      : null;

  revalidateMoney(customerId);
  return { success: true };
}

export async function setVisitWaived(input: WaiveVisitInput): Promise<ActionResult> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const parsed = waiveVisitSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const result = await setVisitWaivedCore(ctx.supabase, {
    tenantId: ctx.tenantId,
    jobId: parsed.data.jobId,
    waived: parsed.data.waived,
  });
  if (!result.success) return result;

  const { data: job } = await ctx.supabase
    .from('jobs')
    .select('customer_id')
    .eq('id', parsed.data.jobId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  const customerId =
    job && typeof (job as { customer_id?: unknown }).customer_id === 'string'
      ? (job as { customer_id: string }).customer_id
      : null;

  revalidateMoney(customerId);
  return { success: true };
}

/** Ensures reference + token; returns what the Copy/Share UI needs. */
export async function getPayLink(customerId: string): Promise<
  | { success: true; url: string; reference: string | null; shareMessage: string }
  | { success: false; error: string }
> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const id = z.string().uuid().safeParse(customerId);
  if (!id.success) return { success: false, error: 'Invalid customer' };

  const { data: customer, error: customerError } = await ctx.supabase
    .from('customers')
    .select('name')
    .eq('id', id.data)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  if (customerError || !customer) {
    return { success: false, error: 'Customer not found.' };
  }

  const reference = await ensurePaymentReference(ctx.supabase, {
    tenantId: ctx.tenantId,
    customerId: id.data,
  });
  const token = await ensurePayLinkToken(ctx.supabase, {
    tenantId: ctx.tenantId,
    customerId: id.data,
  });
  if (!token) return { success: false, error: 'Could not create a pay link.' };

  let url: string;
  try {
    url = payLinkUrl(token);
  } catch (err) {
    console.error('getPayLink url', err);
    return { success: false, error: 'Pay links are not configured.' };
  }

  const [balance, settings, tenantResult] = await Promise.all([
    getCustomerBalance(ctx.supabase, ctx.tenantId, id.data),
    getPaymentSettings(ctx.supabase, ctx.tenantId),
    ctx.supabase.from('tenants').select('name').eq('id', ctx.tenantId).maybeSingle(),
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

  revalidatePath(`/customers/${id.data}`);
  return { success: true, url, reference, shareMessage };
}

/** Email the customer's pay link (same wording as Share). */
export async function emailPayLink(input: {
  customerId: string;
  to?: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const customerId = z.string().uuid().safeParse(input.customerId);
  if (!customerId.success) return { success: false, error: 'Invalid customer' };

  const toRaw = input.to?.trim() ?? '';
  if (toRaw !== '' && !z.string().email().safeParse(toRaw).success) {
    return { success: false, error: 'That email address looks wrong.' };
  }

  const link = await getPayLink(customerId.data);
  if (!link.success) return link;

  const { data: customer } = await ctx.supabase
    .from('customers')
    .select('email, name')
    .eq('id', customerId.data)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  const stored =
    customer && typeof (customer as { email?: unknown }).email === 'string'
      ? (customer as { email: string }).email.trim()
      : '';
  const to = toRaw || stored;
  if (!to) {
    return { success: false, error: 'No email address for this customer' };
  }

  const { data: tenant } = await ctx.supabase
    .from('tenants')
    .select('name, settings')
    .eq('id', ctx.tenantId)
    .maybeSingle();
  const businessName =
    typeof (tenant as { name?: unknown } | null)?.name === 'string'
      ? (tenant as { name: string }).name
      : 'Your cleaner';

  const { sendPayLinkEmail } = await import('@/lib/payments/notify');
  const sent = await sendPayLinkEmail(ctx.supabase, {
    tenantId: ctx.tenantId,
    to,
    businessName,
    shareMessage: link.shareMessage,
    payUrl: link.url,
    tenantSettings: (tenant as { settings?: unknown } | null)?.settings ?? null,
  });
  if (!sent.sent) {
    return { success: false, error: sent.error ?? 'Could not send the email.' };
  }
  return { success: true };
}

const createInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  scope: z.enum(['visit', 'balance']),
  jobId: z.string().uuid().optional(),
  email: z.boolean(),
  to: z.string().trim().email().optional().or(z.literal('')),
});

const resendInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  to: z.string().trim().email().optional().or(z.literal('')),
});

const cancelInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

export async function createInvoice(input: {
  customerId: string;
  scope: 'visit' | 'balance';
  jobId?: string;
  email: boolean;
  to?: string;
}): Promise<
  | { success: true; invoiceId: string; number: string; emailed: boolean; existing: boolean }
  | { success: false; error: string }
> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const parsed = createInvoiceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const created = await createInvoiceCore(ctx.supabase, {
    tenantId: ctx.tenantId,
    customerId: parsed.data.customerId,
    scope: parsed.data.scope,
    jobId: parsed.data.jobId ?? null,
  });
  if (!created.success) return created;

  let emailed = false;
  const to = parsed.data.to?.trim() || null;
  if (parsed.data.email && !created.existing) {
    const sent = await sendInvoiceEmail(ctx.supabase, {
      tenantId: ctx.tenantId,
      invoiceId: created.invoiceId,
      to,
    });
    emailed = sent.sent;
    if (!sent.sent && sent.error) {
      console.error('[createInvoice] email', sent.error);
    }
  }

  revalidateMoney(parsed.data.customerId);
  revalidatePath(`/payments/invoices/${created.invoiceId}`);
  return {
    success: true,
    invoiceId: created.invoiceId,
    number: created.number,
    emailed,
    existing: created.existing,
  };
}

export async function resendInvoice(input: {
  invoiceId: string;
  to?: string;
}): Promise<ActionResult> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const parsed = resendInvoiceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const sent = await sendInvoiceEmail(ctx.supabase, {
    tenantId: ctx.tenantId,
    invoiceId: parsed.data.invoiceId,
    to: parsed.data.to?.trim() || null,
  });
  if (!sent.sent) return { success: false, error: sent.error ?? 'Could not send the invoice' };

  const { data } = await ctx.supabase
    .from('invoices')
    .select('customer_id')
    .eq('id', parsed.data.invoiceId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  const customerId =
    data && typeof (data as { customer_id?: unknown }).customer_id === 'string'
      ? (data as { customer_id: string }).customer_id
      : null;

  revalidateMoney(customerId);
  revalidatePath(`/payments/invoices/${parsed.data.invoiceId}`);
  return { success: true };
}

export async function cancelInvoice(input: {
  invoiceId: string;
  reason?: string;
}): Promise<ActionResult> {
  const ctx = await requireRounds();
  if (!ctx.success) return ctx;

  const parsed = cancelInvoiceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const result = await voidInvoiceCore(ctx.supabase, {
    tenantId: ctx.tenantId,
    invoiceId: parsed.data.invoiceId,
    reason: parsed.data.reason?.trim() ? parsed.data.reason.trim() : null,
  });
  if (!result.success) return result;

  const { data } = await ctx.supabase
    .from('invoices')
    .select('customer_id')
    .eq('id', parsed.data.invoiceId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  const customerId =
    data && typeof (data as { customer_id?: unknown }).customer_id === 'string'
      ? (data as { customer_id: string }).customer_id
      : null;

  revalidateMoney(customerId);
  revalidatePath(`/payments/invoices/${parsed.data.invoiceId}`);
  return { success: true };
}
