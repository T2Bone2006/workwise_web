'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createRoundsCustomer } from '@/lib/actions/customers';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { asLead, buildLeadPrefill, linkLeadToJob } from '@/lib/lite/leads-core';
import { litePaths } from '@/lib/navigation/lite-paths';
import { requireLite } from '@/lib/lite/require-lite';
import { createOneOffVisitCore } from '@/lib/rounds/one-off';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { oneOffVisitSchema } from '@/lib/validations/rounds/visit';
import type { SupabaseClient } from '@supabase/supabase-js';

const CUSTOMER_ERROR = "Couldn't add the customer — try again.";
const VISIT_ERROR = "Customer added, but the visit wasn't booked — try again.";
const LINK_WARNING = "Visit booked, but it couldn't be linked to the enquiry.";
const NOT_WON = 'Mark the lead as won first.';
const NO_ROUNDS = 'One-off visits are part of Rounds.';

const bookFields = oneOffVisitSchema.omit({ customer_id: true }).extend({
  title: z.string().trim().min(1).max(120),
  leadId: z.string().uuid(),
});

export type BookLeadResult =
  | { success: true; jobId: string; customerId: string; warning?: string }
  | { success: false; error: string };

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}

function refresh(leadId: string): void {
  revalidatePath(litePaths.lead(leadId));
  revalidatePath('/lite');
  revalidatePath('/calendar');
}

async function deleteBrandNewJob(admin: SupabaseClient, tenantId: string, jobId: string): Promise<boolean> {
  const { error: historyError } = await admin.from('job_status_history').delete().eq('job_id', jobId);
  if (historyError) {
    console.error('[bookLeadAsOneOff] job_status_history', historyError);
    return false;
  }
  const { error: jobError } = await admin.from('jobs').delete().eq('id', jobId).eq('tenant_id', tenantId);
  if (jobError) {
    console.error('[bookLeadAsOneOff] jobs', jobError);
    return false;
  }
  return true;
}

export async function bookLeadAsOneOffAction(input: {
  leadId: string;
  date: string;
  time: string | null;
  address: string;
  postcode: string;
  price: number;
  durationMinutes: number;
  title: string;
}): Promise<BookLeadResult> {
  const auth = await requireLite();
  if (!auth.ok) return { success: false, error: auth.error };

  const products = await getTenantProducts();
  if (!products.hasRounds) return { success: false, error: NO_ROUNDS };

  const parsed = bookFields.safeParse({
    leadId: input.leadId,
    title: input.title,
    address: input.address,
    postcode: input.postcode,
    price: input.price,
    duration_minutes: input.durationMinutes,
    scheduled_date: input.date,
    scheduled_time: input.time ?? '',
  });
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const admin = createAdminClient();
  const tenantId = auth.ctx.tenantId;
  const { data, error } = await admin
    .from('leads')
    .select('*')
    .eq('id', parsed.data.leadId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) return { success: false, error: "Couldn't save that. Try again." };
  const lead = asLead(data);
  if (!lead) return { success: false, error: 'That lead could not be found.' };
  if (lead.status !== 'won') return { success: false, error: NOT_WON };
  if (lead.converted_job_id) {
    return {
      success: true,
      jobId: lead.converted_job_id,
      customerId: lead.converted_customer_id ?? '',
    };
  }

  let customerId = lead.converted_customer_id;
  let customerWarning: string | undefined;
  if (!customerId) {
    const prefill = buildLeadPrefill(lead);
    const formData = new FormData();
    formData.set('name', prefill.name);
    formData.set('phone', prefill.phone);
    formData.set('email', prefill.email);
    formData.set('address', parsed.data.address);
    formData.set('postcode', parsed.data.postcode);
    formData.set('notes', prefill.notes);
    formData.set('fromLeadId', lead.id);
    let created: Awaited<ReturnType<typeof createRoundsCustomer>>;
    try {
      created = await createRoundsCustomer(formData);
    } catch (createError) {
      console.error('[bookLeadAsOneOff] create customer', createError);
      return { success: false, error: CUSTOMER_ERROR };
    }
    if (!created.success) return { success: false, error: CUSTOMER_ERROR };
    customerId = created.id;
    customerWarning = created.warning;
  }

  const supabase = await createClient();
  const visit = await createOneOffVisitCore(supabase, {
    tenantId,
    actor: { userId: auth.ctx.userId },
    values: {
      customer_id: customerId,
      title: parsed.data.title,
      address: parsed.data.address,
      postcode: parsed.data.postcode,
      price: parsed.data.price,
      duration_minutes: parsed.data.duration_minutes,
      scheduled_date: parsed.data.scheduled_date,
      scheduled_time: parsed.data.scheduled_time ?? '',
    },
  });
  if (!visit.success) {
    refresh(lead.id);
    return { success: false, error: VISIT_ERROR };
  }

  const linked = await linkLeadToJob(admin, {
    tenantId,
    leadId: lead.id,
    jobId: visit.jobId,
    date: parsed.data.scheduled_date,
    time: parsed.data.scheduled_time || null,
  });

  if (linked === 'already_linked') {
    const { data: again } = await admin
      .from('leads')
      .select('converted_job_id, converted_customer_id')
      .eq('id', lead.id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    const existingJobId =
      again && typeof (again as { converted_job_id?: unknown }).converted_job_id === 'string'
        ? (again as { converted_job_id: string }).converted_job_id
        : null;
    const existingCustomerId =
      again && typeof (again as { converted_customer_id?: unknown }).converted_customer_id === 'string'
        ? (again as { converted_customer_id: string }).converted_customer_id
        : customerId;
    if (!existingJobId) {
      refresh(lead.id);
      return { success: true, jobId: visit.jobId, customerId, warning: customerWarning ?? LINK_WARNING };
    }
    const removed = await deleteBrandNewJob(admin, tenantId, visit.jobId);
    if (!removed) return { success: false, error: "Couldn't finish booking — try again." };
    refresh(lead.id);
    return { success: true, jobId: existingJobId, customerId: existingCustomerId };
  }

  refresh(lead.id);
  if (linked === 'error') {
    const warning = customerWarning ? `${customerWarning} ${LINK_WARNING}` : LINK_WARNING;
    return { success: true, jobId: visit.jobId, customerId, warning };
  }
  return customerWarning
    ? { success: true, jobId: visit.jobId, customerId, warning: customerWarning }
    : { success: true, jobId: visit.jobId, customerId };
}
