import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getRoundsSettings } from '@/lib/data/rounds/settings';
import { addDays, isValidYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';
import {
  AGREEMENT_COLUMNS,
  generateVisitsForAgreement,
  mapAgreementRow,
  type AgreementRow,
} from '@/lib/rounds/generate-visits';
import { firstOccurrenceOnOrAfter } from '@/lib/rounds/recurrence';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { deleteUntouchedFutureVisits } from '@/lib/rounds/visit-transitions';

/*
 * Pause and resume a regular service. Shared by the dashboard's server actions
 * and the assistant (which runs with the phone's bearer client too), so it
 * takes the Supabase client rather than reading cookies.
 */

type Result = { success: true; customerId: string } | { success: false; error: string };

export async function loadAgreementRow(
  supabase: SupabaseClient,
  tenantId: string,
  agreementId: string,
): Promise<AgreementRow | null> {
  const { data, error } = await supabase
    .from('service_agreements')
    .select(AGREEMENT_COLUMNS)
    .eq('id', agreementId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return mapAgreementRow(data as unknown as Record<string, unknown>);
}

/** Deletes untouched visits from today (to `pausedUntil`, or all) and marks the agreement paused. */
export async function pauseAgreementCore(
  supabase: SupabaseClient,
  p: { tenantId: string; agreementId: string; pausedUntil: Ymd | null; today?: Ymd },
): Promise<Result> {
  if (p.pausedUntil != null && !isValidYmd(p.pausedUntil)) {
    return { success: false, error: 'Invalid pause date' };
  }
  const existing = await loadAgreementRow(supabase, p.tenantId, p.agreementId);
  if (!existing) return { success: false, error: 'Agreement not found' };
  if (existing.status === 'ended') return { success: false, error: 'This agreement has ended' };

  const today = p.today ?? todayInLondon();
  let nextDueDate = existing.next_due_date;
  if (p.pausedUntil) {
    nextDueDate = firstOccurrenceOnOrAfter(existing.next_due_date, existing.frequency_days, addDays(p.pausedUntil, 1));
  }

  try {
    await deleteUntouchedFutureVisits(supabase, {
      tenantId: p.tenantId,
      agreementId: existing.id,
      fromDate: today,
      toDate: p.pausedUntil ?? undefined,
    });
    const { error } = await supabase
      .from('service_agreements')
      .update({ status: 'paused', paused_until: p.pausedUntil, next_due_date: nextDueDate })
      .eq('id', existing.id)
      .eq('tenant_id', p.tenantId);
    if (error) {
      console.error('[pauseAgreementCore]', error);
      return { success: false, error: error.message };
    }
  } catch (err) {
    console.error('[pauseAgreementCore]', err);
    return { success: false, error: err instanceof Error ? err.message : 'Failed to pause agreement' };
  }
  return { success: true, customerId: existing.customer_id };
}

/** Marks the agreement active from today and books its next visits. */
export async function resumeAgreementCore(
  supabase: SupabaseClient,
  p: { tenantId: string; agreementId: string; today?: Ymd },
): Promise<Result> {
  const existing = await loadAgreementRow(supabase, p.tenantId, p.agreementId);
  if (!existing) return { success: false, error: 'Agreement not found' };
  if (existing.status === 'ended') return { success: false, error: 'This agreement has ended' };

  const today = p.today ?? todayInLondon();
  const nextDueDate = firstOccurrenceOnOrAfter(existing.next_due_date, existing.frequency_days, today);
  const { error } = await supabase
    .from('service_agreements')
    .update({ status: 'active', paused_until: null, next_due_date: nextDueDate })
    .eq('id', existing.id)
    .eq('tenant_id', p.tenantId);
  if (error) {
    console.error('[resumeAgreementCore]', error);
    return { success: false, error: error.message };
  }

  const updated = await loadAgreementRow(supabase, p.tenantId, existing.id);
  if (!updated) return { success: false, error: 'Agreement resumed but could not be reloaded' };
  try {
    const [settings, solo] = await Promise.all([
      getRoundsSettings(supabase, p.tenantId),
      getSoloWorkerForTenant(supabase, p.tenantId),
    ]);
    await generateVisitsForAgreement(supabase, {
      tenantId: p.tenantId,
      agreement: updated,
      settings,
      workerId: updated.assigned_worker_id ?? solo?.id ?? null,
    });
  } catch (err) {
    console.error('[resumeAgreementCore] generate', err);
    return { success: false, error: err instanceof Error ? err.message : 'Failed to generate visits' };
  }
  return { success: true, customerId: existing.customer_id };
}
