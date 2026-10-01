'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { isValidYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import { createOneOffVisitCore } from '@/lib/rounds/one-off';
import { sendVisitDoneAfterSkip } from '@/lib/payments/notify';
import {
  notifyVisitChange,
  notifyVisitChangeUndone,
  requestChangeNotice,
  type NoticeCounts,
} from '@/lib/messaging/visit-change-notices';
import { optimiseDayCore } from '@/lib/rounds/optimise-day';
import {
  latestUndoableChange,
  moveRemainingWithLog,
  moveStopToDayWithLog,
  rescheduleVisitWithLog,
  skipRemainingCore,
  skipVisitWithLog,
  swapDaysWithLog,
  undoVisitChangeCore,
  type VisitChangeSummary,
} from '@/lib/rounds/visit-changes';
import {
  completeVisitCore,
  reorderDayCore,
  type Actor,
} from '@/lib/rounds/visit-transitions';
import {
  completeVisitSchema,
  moveRemainingSchema,
  moveStopSchema,
  oneOffVisitSchema,
  reorderDaySchema,
  rescheduleVisitSchema,
  skipRemainingSchema,
  skipVisitSchema,
  swapDaysSchema,
  tellChangeSchema,
  undoVisitChangeSchema,
  type CompleteVisitInput,
  type MoveRemainingInput,
  type MoveStopInput,
  type OneOffVisitInput,
  type ReorderDayInput,
  type RescheduleVisitInput,
  type SkipRemainingInput,
  type SkipVisitInput,
  type SwapDaysInput,
  type TellChangeInput,
  type UndoVisitChangeInput,
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
  revalidatePath('/dashboard');
  revalidatePath('/calendar');
  revalidatePath('/customers');
  revalidatePath('/payments');
  if (customerId) revalidatePath(`/customers/${customerId}`);
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

/** The board's actions move many customers' visits at once: only a Rounds business may use them. */
async function requireRoundsActor(): Promise<
  | { success: true; tenantId: string; actor: Actor }
  | { success: false; error: string }
> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;
  const products = await getTenantProducts();
  if (!products.hasRounds) return { success: false, error: 'Not available' };
  return ctx;
}

async function noticeForChange(
  tenantId: string,
  changeId: string | null | undefined,
  asked: boolean,
): Promise<NoticeCounts | undefined> {
  if (!changeId || !asked) return undefined;
  try {
    return await notifyVisitChange({ tenantId, changeId });
  } catch (err) {
    console.error('[visits] notifyVisitChange', err instanceof Error ? err.message : 'failed');
    return undefined;
  }
}

export async function completeVisit(
  input: CompleteVisitInput,
): Promise<
  ActionResult & {
    alreadyCompleted?: boolean;
    skippedElsewhere?: boolean;
    /** False when a payment was sent but not recorded (the visit was already done or skipped). */
    paymentRecorded?: boolean;
  }
> {
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
    payment: parsed.data.payment,
    sendInvoice: parsed.data.sendInvoice,
    clientMutationId: parsed.data.clientMutationId,
    completedAt: parsed.data.completedAt,
    // A stale page must not record the phone's cash a second time.
    alreadyDonePayment: 'ignore',
  });
  if (!result.success) return { success: false, error: result.error };

  const { data: job } = await supabase
    .from('jobs')
    .select('customer_id')
    .eq('id', parsed.data.jobId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  const customerId =
    job && typeof (job as { customer_id?: unknown }).customer_id === 'string'
      ? (job as { customer_id: string }).customer_id
      : null;

  revalidateVisits(customerId);
  return {
    success: true,
    alreadyCompleted: result.alreadyCompleted,
    skippedElsewhere: result.skippedElsewhere,
    paymentRecorded: result.paymentId != null,
  };
}

export async function skipVisit(
  input: SkipVisitInput,
): Promise<ActionResult & { changeId?: string | null; notified?: NoticeCounts }> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;

  const parsed = skipVisitSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const notify = parsed.data.notifyCustomer ?? false;
  const supabase = await createClient();
  const result = await skipVisitWithLog(supabase, {
    tenantId: ctx.tenantId,
    jobId: parsed.data.jobId,
    reason: parsed.data.reason,
    note: emptyToNull(parsed.data.note),
    actor: ctx.actor,
    notifyCustomer: notify,
  });
  if (!result.success) return { success: false, error: result.error };

  const notified = await noticeForChange(ctx.tenantId, result.changeId, notify);
  // Skipping the last service left at a house sends the stop's visit-done message.
  await sendVisitDoneAfterSkip(supabase, { tenantId: ctx.tenantId, jobId: parsed.data.jobId });
  revalidateVisits();
  return {
    success: true,
    changeId: result.changeId ?? null,
    ...(notified ? { notified } : {}),
  };
}

export async function rescheduleVisit(
  input: RescheduleVisitInput,
): Promise<ActionResult & { changeId?: string | null; notified?: NoticeCounts }> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;

  const parsed = rescheduleVisitSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const notify = parsed.data.notifyCustomer ?? false;
  const supabase = await createClient();
  const result = await rescheduleVisitWithLog(supabase, {
    tenantId: ctx.tenantId,
    jobId: parsed.data.jobId,
    scheduledDate: parsed.data.scheduledDate,
    scheduledTime: emptyToNull(parsed.data.scheduledTime),
    actor: ctx.actor,
    notifyCustomer: notify,
  });
  if (!result.success) return result;

  const notified = await noticeForChange(ctx.tenantId, result.changeId, notify);
  revalidateVisits();
  return {
    success: true,
    changeId: result.changeId ?? null,
    ...(notified ? { notified } : {}),
  };
}

export async function moveRemaining(
  input: MoveRemainingInput,
): Promise<
  | { success: true; moved: number; changeId: string | null; notified?: NoticeCounts }
  | { success: false; error: string }
> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;

  const parsed = moveRemainingSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const notify = parsed.data.notifyCustomers ?? false;
  const supabase = await createClient();
  const result = await moveRemainingWithLog(supabase, {
    tenantId: ctx.tenantId,
    fromDate: parsed.data.fromDate,
    toDate: parsed.data.toDate,
    scheduledTime: emptyToNull(parsed.data.scheduledTime),
    actor: ctx.actor,
    notifyCustomers: notify,
  });
  if (!result.success) return result;

  const notified = await noticeForChange(ctx.tenantId, result.changeId, notify);
  revalidateVisits();
  return {
    success: true,
    moved: result.moved,
    changeId: result.changeId,
    ...(notified ? { notified } : {}),
  };
}

export async function moveStopToDay(
  input: MoveStopInput,
): Promise<
  | { success: true; moved: number; changeId: string | null; orderSaved: boolean }
  | { success: false; error: string }
> {
  const ctx = await requireRoundsActor();
  if (!ctx.success) return ctx;

  const parsed = moveStopSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const result = await moveStopToDayWithLog(supabase, {
    tenantId: ctx.tenantId,
    jobIds: parsed.data.jobIds,
    toDate: parsed.data.toDate,
    orderedJobIds: parsed.data.orderedJobIds,
    today: todayInLondon(),
    actor: ctx.actor,
  });
  if (!result.success) return result;

  revalidateVisits();
  return result;
}

export async function swapDays(
  input: SwapDaysInput,
): Promise<
  | {
      success: true;
      changeId: string;
      movedToB: number;
      movedToA: number;
      orderSaved: boolean;
      alreadyDone: boolean;
      notified?: NoticeCounts;
    }
  | { success: false; error: string; changeId?: string }
> {
  const ctx = await requireRoundsActor();
  if (!ctx.success) return ctx;

  const parsed = swapDaysSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const notify = parsed.data.notifyCustomers ?? false;
  const supabase = await createClient();
  const result = await swapDaysWithLog(supabase, {
    tenantId: ctx.tenantId,
    dayA: parsed.data.dayA,
    dayB: parsed.data.dayB,
    clientKey: parsed.data.clientKey,
    notifyCustomers: notify,
    today: todayInLondon(),
    actor: ctx.actor,
  });
  if (!result.success) {
    // Part-way: some jobs did move, so the screens must refresh.
    if (result.changeId) revalidateVisits();
    return result;
  }

  const notified = result.alreadyDone
    ? undefined
    : await noticeForChange(ctx.tenantId, result.changeId, notify);
  revalidateVisits();
  return { ...result, ...(notified ? { notified } : {}) };
}

export async function tellCustomersAboutChange(
  input: TellChangeInput,
): Promise<
  | { success: true; alreadyTold: boolean; notified: NoticeCounts }
  | { success: false; error: string }
> {
  const ctx = await requireRoundsActor();
  if (!ctx.success) return ctx;

  const parsed = tellChangeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const supabase = await createClient();
  try {
    const result = await requestChangeNotice(supabase, {
      tenantId: ctx.tenantId,
      changeId: parsed.data.changeId,
      today: todayInLondon(),
    });
    if (result.success) revalidateVisits();
    return result;
  } catch (err) {
    console.error('[visits] tellCustomersAboutChange', err instanceof Error ? err.message : 'failed');
    return { success: false, error: 'Could not tell them. Try again.' };
  }
}

export async function skipRemaining(
  input: SkipRemainingInput,
): Promise<
  | { success: true; skipped: number; changeId: string | null; notified?: NoticeCounts }
  | { success: false; error: string }
> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;

  const parsed = skipRemainingSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const notify = parsed.data.notifyCustomers ?? false;
  const supabase = await createClient();
  const result = await skipRemainingCore(supabase, {
    tenantId: ctx.tenantId,
    date: parsed.data.date,
    actor: ctx.actor,
    notifyCustomers: notify,
  });
  if (!result.success) return result;

  const notified = await noticeForChange(ctx.tenantId, result.changeId, notify);
  revalidateVisits();
  return {
    success: true,
    skipped: result.skipped,
    changeId: result.changeId,
    ...(notified ? { notified } : {}),
  };
}

export async function undoVisitChange(
  input: UndoVisitChangeInput,
): Promise<
  | { success: true; restored: number; leftAlone: number; notified?: NoticeCounts }
  | { success: false; error: string }
> {
  const ctx = await requireActor();
  if (!ctx.success) return ctx;

  const parsed = undoVisitChangeSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const result = await undoVisitChangeCore(supabase, {
    tenantId: ctx.tenantId,
    changeId: parsed.data.changeId,
    actor: ctx.actor,
  });
  if (!result.success) return { success: false, error: result.error };

  let notified: NoticeCounts | undefined;
  if (result.change.notifiedAt && parsed.data.notifyCustomers !== false) {
    try {
      notified = await notifyVisitChangeUndone({
        tenantId: ctx.tenantId,
        changeId: result.change.id,
        restoredJobIds: result.restoredJobIds,
      });
    } catch (err) {
      console.error(
        '[visits] notifyVisitChangeUndone',
        err instanceof Error ? err.message : 'failed',
      );
    }
  }

  revalidateVisits();
  return {
    success: true,
    restored: result.restored,
    leftAlone: result.leftAlone,
    ...(notified ? { notified } : {}),
  };
}

export async function getLatestUndoableChange(
  date?: string,
): Promise<VisitChangeSummary | null> {
  const ctx = await requireActor();
  if (!ctx.success) return null;
  if (date != null && date !== '' && !isValidYmd(date)) return null;

  const supabase = await createClient();
  if (date != null && date !== '' && isValidYmd(date)) {
    return latestUndoableChange(supabase, ctx.tenantId, { date });
  }
  return latestUndoableChange(supabase, ctx.tenantId);
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

  const supabase = await createClient();
  const result = await createOneOffVisitCore(supabase, {
    tenantId: ctx.tenantId,
    actor: ctx.actor,
    values: parsed.data,
  });
  if (!result.success) return result;

  revalidateVisits(parsed.data.customer_id);
  return result;
}
