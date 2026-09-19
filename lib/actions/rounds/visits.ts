'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { isValidYmd, type Ymd } from '@/lib/rounds/dates';
import { oneOffReferenceNumber } from '@/lib/rounds/recurrence';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { optimiseDayCore } from '@/lib/rounds/optimise-day';
import {
  completeVisitCore,
  moveRemainingCore,
  reorderDayCore,
  rescheduleVisitCore,
  skipVisitCore,
  type Actor,
} from '@/lib/rounds/visit-transitions';
import { resolveJobCoordinates } from '@/lib/utils/geocoding';
import {
  completeVisitSchema,
  moveRemainingSchema,
  oneOffVisitSchema,
  reorderDaySchema,
  rescheduleVisitSchema,
  skipVisitSchema,
  type CompleteVisitInput,
  type MoveRemainingInput,
  type OneOffVisitInput,
  type ReorderDayInput,
  type RescheduleVisitInput,
  type SkipVisitInput,
} from '@/lib/validations/rounds/visit';

export type ActionResult = { success: true } | { success: false; error: string };

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function revalidateVisits(customerId?: string | null) {
  revalidatePath('/rounds');
  revalidatePath('/dashboard');
  revalidatePath('/rounds/calendar');
  if (customerId) revalidatePath(`/rounds/customers/${customerId}`);
}

async function requireActor(): Promise<
  | { success: true; tenantId: string; actor: Actor }
  | { success: false; error: string }
> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not authenticated' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { success: true, tenantId, actor: { userId: user?.id } };
}

function random4hex(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 4);
}

export async function completeVisit(input: CompleteVisitInput): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;

  const parsed = completeVisitSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const result = await completeVisitCore(supabase, {
    tenantId: ctx.tenantId,
    jobId: parsed.data.jobId,
    finalAmount: parsed.data.finalAmount,
    notes: emptyToNull(parsed.data.notes),
    actor: ctx.actor,
  });
  if (!result.success) return result;

  revalidateVisits();
  return { success: true };
}

export async function skipVisit(input: SkipVisitInput): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;

  const parsed = skipVisitSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const result = await skipVisitCore(supabase, {
    tenantId: ctx.tenantId,
    jobId: parsed.data.jobId,
    reason: parsed.data.reason,
    note: emptyToNull(parsed.data.note),
    actor: ctx.actor,
  });
  if (!result.success) return result;

  revalidateVisits();
  return { success: true };
}

export async function rescheduleVisit(input: RescheduleVisitInput): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;

  const parsed = rescheduleVisitSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const result = await rescheduleVisitCore(supabase, {
    tenantId: ctx.tenantId,
    jobId: parsed.data.jobId,
    scheduledDate: parsed.data.scheduledDate,
    scheduledTime: emptyToNull(parsed.data.scheduledTime),
    actor: ctx.actor,
  });
  if (!result.success) return result;

  revalidateVisits();
  return { success: true };
}

export async function moveRemaining(
  input: MoveRemainingInput,
): Promise<{ success: true; moved: number } | { success: false; error: string }> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;

  const parsed = moveRemainingSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const result = await moveRemainingCore(supabase, {
    tenantId: ctx.tenantId,
    fromDate: parsed.data.fromDate,
    toDate: parsed.data.toDate,
    scheduledTime: emptyToNull(parsed.data.scheduledTime),
    actor: ctx.actor,
  });
  if (!result.success) return result;

  revalidateVisits();
  return result;
}

export async function reorderDay(input: ReorderDayInput): Promise<ActionResult> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;

  const parsed = reorderDaySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const result = await reorderDayCore(supabase, {
    tenantId: ctx.tenantId,
    date: parsed.data.date,
    orderedJobIds: parsed.data.jobIds,
  });
  if (!result.success) return result;

  revalidateVisits();
  return { success: true };
}

export async function optimiseDay(
  date: Ymd,
): Promise<{ success: true; distanceKm: number; stops: number } | { success: false; error: string }> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;
  if (!isValidYmd(date)) return { success: false, error: 'Pick a valid date.' };

  const supabase = await createClient();
  const result = await optimiseDayCore(supabase, {
    tenantId: ctx.tenantId,
    date,
    persist: true,
  });
  if (!result.success) return result;

  revalidateVisits();
  return {
    success: true,
    distanceKm: result.distanceKm,
    stops: result.stops.length,
  };
}

export async function createOneOffVisit(
  input: OneOffVisitInput,
): Promise<{ success: true; jobId: string } | { success: false; error: string }> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;

  const parsed = oneOffVisitSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };
  const values = parsed.data;

  const supabase = await createClient();
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id')
    .eq('id', values.customer_id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (customerError) return { success: false, error: customerError.message };
  if (!customer) return { success: false, error: 'Customer not found' };

  const [coords, solo] = await Promise.all([
    resolveJobCoordinates({
      postcode: values.postcode,
      fullAddress: `${values.address}, ${values.postcode}`,
    }),
    getSoloWorkerForTenant(supabase, ctx.tenantId),
  ]);

  const scheduledTime = emptyToNull(values.scheduled_time);
  const accessNotes = emptyToNull(values.access_notes);

  const { data, error } = await supabase
    .from('jobs')
    .insert({
      tenant_id: ctx.tenantId,
      reference_number: oneOffReferenceNumber(values.scheduled_date, random4hex()),
      customer_id: values.customer_id,
      assigned_worker_id: solo?.id ?? null,
      service_agreement_id: null,
      agreement_occurrence_date: null,
      address: values.address,
      postcode: values.postcode,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      job_description: values.title,
      status: 'assigned',
      priority: 'normal',
      scheduled_date: values.scheduled_date,
      scheduled_time: scheduledTime,
      estimated_duration_minutes: values.duration_minutes,
      quoted_amount: values.price,
      payment_status: 'unpaid',
      customer_confirmation_status: null,
      route_position: null,
      required_skills: [],
      industry_data: {},
      custom_fields: {
        rounds: {
          agreement_id: null,
          service_name: null,
          access_notes: accessNotes,
        },
      },
    })
    .select('id')
    .single();

  if (error || typeof data?.id !== 'string') {
    console.error('[createOneOffVisit]', error);
    return { success: false, error: error?.message ?? 'Failed to create job' };
  }

  const { error: historyError } = await supabase.from('job_status_history').insert({
    job_id: data.id,
    from_status: null,
    to_status: 'assigned',
    created_at: new Date().toISOString(),
    changed_by_user_id: ctx.actor.userId ?? null,
    changed_by_worker_id: ctx.actor.workerId ?? null,
    notes: 'One-off visit',
    metadata: {},
  });
  if (historyError) {
    console.error('[createOneOffVisit] job_status_history', historyError);
  }

  revalidateVisits(values.customer_id);
  return { success: true, jobId: data.id };
}
