import type { SupabaseClient } from '@supabase/supabase-js';
import { ensurePaymentReference } from '@/lib/payments/money-core';

export async function createInvoiceCore(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    customerId: string;
    scope: 'visit' | 'balance';
    jobId?: string | null;
    /** A visit invoice for a whole stop (several services at one house). */
    jobIds?: string[];
  },
): Promise<
  | { success: true; invoiceId: string; number: string; existing: boolean }
  | { success: false; error: string }
> {
  await ensurePaymentReference(supabase, {
    tenantId: p.tenantId,
    customerId: p.customerId,
  });

  let jobIds: string[];
  if (p.scope === 'visit') {
    const jobId = p.jobId?.trim() ?? '';
    if (!jobId) {
      return { success: false, error: 'A visit is required' };
    }
    const existing = await findIssuedVisitInvoice(supabase, {
      tenantId: p.tenantId,
      customerId: p.customerId,
      jobId,
    });
    if (existing) {
      return {
        success: true,
        invoiceId: existing.id,
        number: existing.number,
        existing: true,
      };
    }
    jobIds = p.jobIds && p.jobIds.length > 0 ? [...new Set([jobId, ...p.jobIds])] : [jobId];
  } else {
    const { data, error } = await supabase
      .from('jobs')
      .select('id')
      .eq('tenant_id', p.tenantId)
      .eq('customer_id', p.customerId)
      .eq('status', 'completed')
      .in('payment_status', ['unpaid', 'partial']);

    if (error) {
      console.error('createInvoiceCore visits failed', error);
      return { success: false, error: 'Could not create the invoice' };
    }

    jobIds = (data ?? [])
      .map((row) => {
        const id = (row as { id?: unknown }).id;
        return typeof id === 'string' ? id : null;
      })
      .filter((id): id is string => id != null);

    if (jobIds.length === 0) {
      return { success: false, error: 'Nothing owed to invoice' };
    }
  }

  const { data, error } = await supabase.rpc('create_invoice', {
    p_customer_id: p.customerId,
    p_job_ids: jobIds,
    p_kind: p.scope,
  });

  if (error) {
    if (error.code === '22023') {
      return {
        success: false,
        error: error.message || 'Could not create the invoice',
      };
    }
    if (error.code === '42501') {
      return { success: false, error: 'Not allowed' };
    }
    console.error('createInvoiceCore rpc failed', error);
    return { success: false, error: 'Could not create the invoice' };
  }

  const invoiceId = typeof data === 'string' ? data : null;
  if (!invoiceId) {
    return { success: false, error: 'Could not create the invoice' };
  }

  const { data: created, error: readError } = await supabase
    .from('invoices')
    .select('number')
    .eq('id', invoiceId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();

  if (readError) {
    console.error('createInvoiceCore read number failed', readError);
    return { success: false, error: 'Could not create the invoice' };
  }

  const number = (created as { number?: unknown } | null)?.number;
  if (typeof number !== 'string' || number.trim() === '') {
    return { success: false, error: 'Could not create the invoice' };
  }

  return { success: true, invoiceId, number, existing: false };
}

export async function voidInvoiceCore(
  supabase: SupabaseClient,
  p: { tenantId: string; invoiceId: string; reason: string | null },
): Promise<{ success: true } | { success: false; error: string }> {
  const { data, error } = await supabase
    .from('invoices')
    .select('status')
    .eq('id', p.invoiceId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();

  if (error) {
    console.error('voidInvoiceCore read failed', error);
    return { success: false, error: 'Could not void the invoice' };
  }
  if (!data) {
    return { success: false, error: 'Invoice not found' };
  }

  const status = (data as { status?: unknown }).status;
  if (status === 'void') return { success: true };
  if (status !== 'issued') {
    return { success: false, error: 'Could not void the invoice' };
  }

  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      status: 'void',
      voided_at: new Date().toISOString(),
      void_reason: p.reason,
    })
    .eq('id', p.invoiceId)
    .eq('tenant_id', p.tenantId)
    .eq('status', 'issued');

  if (updateError) {
    console.error('voidInvoiceCore update failed', updateError);
    return { success: false, error: 'Could not void the invoice' };
  }

  return { success: true };
}

async function findIssuedVisitInvoice(
  supabase: SupabaseClient,
  p: { tenantId: string; customerId: string; jobId: string },
): Promise<{ id: string; number: string } | null> {
  const { data: lines, error: linesError } = await supabase
    .from('invoice_lines')
    .select('invoice_id')
    .eq('tenant_id', p.tenantId)
    .eq('job_id', p.jobId);

  if (linesError) {
    console.error('createInvoiceCore existing lookup failed', linesError);
    return null;
  }

  const invoiceIds = [
    ...new Set(
      (lines ?? [])
        .map((row) => (row as { invoice_id?: unknown }).invoice_id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  if (invoiceIds.length === 0) return null;

  const { data: invoices, error: invoicesError } = await supabase
    .from('invoices')
    .select('id, number')
    .in('id', invoiceIds)
    .eq('tenant_id', p.tenantId)
    .eq('customer_id', p.customerId)
    .eq('kind', 'visit')
    .eq('status', 'issued')
    .limit(1);

  if (invoicesError) {
    console.error('createInvoiceCore existing invoice failed', invoicesError);
    return null;
  }

  const row = (invoices ?? [])[0] as { id?: unknown; number?: unknown } | undefined;
  if (!row || typeof row.id !== 'string' || typeof row.number !== 'string') {
    return null;
  }
  return { id: row.id, number: row.number };
}
