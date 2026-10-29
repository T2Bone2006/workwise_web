import type { SupabaseClient } from '@supabase/supabase-js';
import { createInvoiceCore } from '@/lib/invoices/invoice-core';
import { sendInvoiceEmail, sendVisitDoneNotice } from '@/lib/payments/notify';
import { setCustomerSendsInvoice } from '@/lib/payments/money-core';
import { isValidYmd, type Ymd } from '@/lib/rounds/dates';
import { isRemainingVisit, noticePlan } from '@/lib/rounds/remaining-plan';
import { completeVisitCore, type Actor } from '@/lib/rounds/visit-transitions';

export { isRemainingVisit } from '@/lib/rounds/remaining-plan';

type OpenJob = {
  id: string;
  customerId: string | null;
  address: string;
  postcode: string;
  quotedAmount: number | null;
};

export type CompleteRemainingResult =
  | { success: true; done: number; cash: number; messages: number; invoices: number }
  | { success: false; error: string };

export async function completeRemainingCore(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    actor: Actor;
    date: Ymd;
    rows: {
      jobId: string;
      cashAmount: number | null;
      sendMessage: boolean;
      sendInvoice: boolean;
    }[];
  },
): Promise<CompleteRemainingResult> {
  if (!isValidYmd(p.date)) return { success: false, error: 'Pick a valid date.' };
  const ids = p.rows.map((row) => row.jobId);
  if (new Set(ids).size !== ids.length) {
    return { success: false, error: 'A visit is listed twice.' };
  }

  const { data, error } = await supabase
    .from('jobs')
    .select('id, status, scheduled_date, customer_id, address, postcode, quoted_amount')
    .eq('tenant_id', p.tenantId)
    .in('id', ids);

  if (error) {
    console.error('[completeRemainingCore]', error);
    return { success: false, error: 'Could not load these visits. Try again.' };
  }

  const open = new Map<string, OpenJob>();
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : null;
    const status = typeof row.status === 'string' ? row.status : '';
    const scheduled = typeof row.scheduled_date === 'string' ? row.scheduled_date.slice(0, 10) : '';
    if (!id || scheduled !== p.date || !isRemainingVisit(status)) continue;
    const quoted = row.quoted_amount;
    open.set(id, {
      id,
      customerId: typeof row.customer_id === 'string' ? row.customer_id : null,
      address: typeof row.address === 'string' ? row.address : '',
      postcode: typeof row.postcode === 'string' ? row.postcode : '',
      quotedAmount:
        typeof quoted === 'number' && Number.isFinite(quoted)
          ? quoted
          : typeof quoted === 'string' && quoted.trim() !== '' && Number.isFinite(Number(quoted))
            ? Number(quoted)
            : null,
    });
  }

  if (open.size !== ids.length) {
    return { success: false, error: 'One of these visits is no longer on this day. Refresh and try again.' };
  }

  let done = 0;
  let cash = 0;
  for (const choice of p.rows) {
    const job = open.get(choice.jobId);
    if (!job) return { success: false, error: 'One of these visits is no longer on this day. Refresh and try again.' };
    const result = await completeVisitCore(supabase, {
      tenantId: p.tenantId,
      jobId: choice.jobId,
      actor: p.actor,
      finalAmount: job.quotedAmount,
      payment: choice.cashAmount != null ? { method: 'cash', amount: choice.cashAmount } : null,
      sendInvoice: choice.sendInvoice,
      notify: false,
      alreadyDonePayment: 'ignore',
    });
    if (!result.success) return { success: false, error: result.error };
    done += 1;
    if (choice.cashAmount != null && result.paymentId) cash += 1;
  }

  const plan = noticePlan(
    p.rows.map((choice) => {
      const job = open.get(choice.jobId)!;
      return {
        jobId: choice.jobId,
        customerId: job.customerId,
        address: job.address,
        postcode: job.postcode,
        sendMessage: choice.sendMessage,
        sendInvoice: choice.sendInvoice,
      };
    }),
  );

  let messages = 0;
  for (const house of plan.messages) {
    if (house.customerId) {
      await setCustomerSendsInvoice(supabase, {
        tenantId: p.tenantId,
        customerId: house.customerId,
        sendInvoice: house.sendInvoice,
      });
    }
    try {
      const notice = await sendVisitDoneNotice(supabase, { tenantId: p.tenantId, jobId: house.jobId });
      if (notice.outcome === 'sent' || notice.outcome === 'held' || notice.outcome === 'already_sent') {
        messages += 1;
      }
    } catch (err) {
      console.error('[completeRemainingCore] notice', house.jobId, err);
    }
  }

  let invoices = 0;
  for (const bill of plan.invoiceOnly) {
    try {
      await setCustomerSendsInvoice(supabase, {
        tenantId: p.tenantId,
        customerId: bill.customerId,
        sendInvoice: true,
      });
      const created = await createInvoiceCore(supabase, {
        tenantId: p.tenantId,
        customerId: bill.customerId,
        scope: 'visit',
        jobId: bill.jobIds[0],
        jobIds: bill.jobIds,
      });
      if (!created.success) {
        console.error('[completeRemainingCore] invoice', created.error);
        continue;
      }
      invoices += 1;
      const sent = await sendInvoiceEmail(supabase, { tenantId: p.tenantId, invoiceId: created.invoiceId });
      if (!sent.sent && sent.error) console.error('[completeRemainingCore] invoice email', sent.error);
    } catch (err) {
      console.error('[completeRemainingCore] invoice', err);
    }
  }

  return { success: true, done, cash, messages, invoices };
}
