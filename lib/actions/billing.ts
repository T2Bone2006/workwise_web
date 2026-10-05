'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { isBillingInterval, isPlanKey, type PlanChoice } from '@/lib/billing/plans';
import {
  cancelPendingChange,
  cancelPlan,
  cardUpdateUrl,
  changePlan,
  previewPlanChange,
  undoCancel,
} from '@/lib/billing/manage';
import { createRestartCheckout } from '@/lib/billing/restart';

const OWNER_ONLY = 'Only the account owner can change the plan.';
const NOT_OFFERED = 'That change isn’t available here. Contact us and we’ll sort it.';
const MANAGED_ERROR = 'Your plan is managed by WorkWise. Contact us to make changes.';
const PORTAL_ERROR = 'Could not open the billing portal. Please try again.';
const RESTART_ERROR = "Couldn't restart your plan. Nothing was charged. Please try again.";

async function adminTenant(): Promise<{ ok: true; tenantId: string } | { ok: false; error: string }> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { ok: false, error: 'No tenant found for this login.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'No tenant found for this login.' };

  const { data, error } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
  if (error || data?.role !== 'admin') return { ok: false, error: OWNER_ONLY };
  return { ok: true, tenantId };
}

function asChoice(target: unknown): PlanChoice | null {
  if (!target || typeof target !== 'object') return null;
  const plan = 'plan' in target ? target.plan : undefined;
  const interval = 'interval' in target ? target.interval : undefined;
  if (!isPlanKey(plan) || !isBillingInterval(interval)) return null;
  return { plan, interval };
}

function refresh<T extends { ok: boolean }>(result: T): T {
  if (result.ok) revalidatePath('/settings');
  return result;
}

export async function hasLiteNowAction(): Promise<boolean> {
  return (await getTenantProducts()).hasLite;
}

/** True once the restart webhook has written an entitled plan. Polled from ?restarted=1. */
export async function planIsBackAction(): Promise<boolean> {
  const products = await getTenantProducts();
  return products.primary !== null && products.source === 'subscriptions';
}

export async function startRestartAction(
  choice: PlanChoice,
  nonce: string,
): Promise<{ ok: false; error: string } | never> {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  const parsed = asChoice(choice);
  if (!parsed) return { ok: false, error: NOT_OFFERED };
  let url: string;
  try {
    url = await createRestartCheckout(gate.tenantId, parsed, nonce);
  } catch (err) {
    console.error('[startRestart]', err instanceof Error ? err.name : 'Error');
    if (err instanceof Error && err.message === 'managed') return { ok: false, error: MANAGED_ERROR };
    return { ok: false, error: RESTART_ERROR };
  }
  redirect(url);
}

export async function previewPlanChangeAction(target: unknown) {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  const choice = asChoice(target);
  if (!choice) return { ok: false as const, error: NOT_OFFERED };
  return previewPlanChange(gate.tenantId, choice);
}

export async function changePlanAction(target: unknown, expectedTodayPence: number, nonce: string) {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  const choice = asChoice(target);
  if (!choice) return { ok: false as const, error: NOT_OFFERED };
  return refresh(await changePlan(gate.tenantId, choice, expectedTodayPence, nonce));
}

export async function cancelPendingChangeAction() {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  return refresh(await cancelPendingChange(gate.tenantId));
}

export async function cancelPlanAction() {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  return refresh(await cancelPlan(gate.tenantId));
}

export async function undoCancelAction() {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  return refresh(await undoCancel(gate.tenantId));
}

/** Opens Stripe's portal straight at the card form. */
export async function openCardUpdate(): Promise<{ ok: false; error: string }> {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  let url: string;
  try {
    url = await cardUpdateUrl(gate.tenantId);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === MANAGED_ERROR) return { ok: false, error: message };
    console.error('[openCardUpdate]', err instanceof Error ? err.name : 'Error');
    return { ok: false, error: PORTAL_ERROR };
  }
  redirect(url);
}

/**
 * @deprecated Alias of openCardUpdate. Kept so the current settings button still compiles
 * until the Plan & billing page (step 14) replaces it.
 */
export async function openBillingPortal(): Promise<{ success: false; error: string } | never> {
  const result = await openCardUpdate();
  return { success: false, error: result.error };
}
