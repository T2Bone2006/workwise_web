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
import { isProTier } from '@/lib/billing/pro-plans';
import type { ProChangeResult, ProUpgradePreview, ProYearlyPreview } from '@/lib/billing/pro-manage';

// pro-manage reaches the Resend client (through the worker count), which needs its API key at import; load it only when used.
const proManage = () => import('@/lib/billing/pro-manage');
const proRestart = () => import('@/lib/billing/pro-restart');
import { GATE_MESSAGE } from '@/lib/billing/worker-gate';
import { createWorkerLiteCheckout, isWorkerBusiness } from '@/lib/billing/worker-lite';

const OWNER_ONLY = 'Only the account owner can change the plan.';
const NOT_OFFERED = 'That change isn’t available here. Contact us and we’ll sort it.';
const MANAGED_ERROR = 'Your plan is managed by WorkWise. Contact us to make changes.';
const PORTAL_ERROR = 'Could not open the billing portal. Please try again.';
const WORKER_NO_ROUNDS = "Rounds isn't available with an account made from a worker invite.";
const WORKER_LITE_ERROR = "Couldn't start the payment. Nothing was charged. Please try again.";
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

export async function startProRestartAction(
  choice: unknown,
  nonce: unknown,
): Promise<{ ok: false; error: string } | never> {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  const tier = choice && typeof choice === 'object' && 'tier' in choice ? choice.tier : undefined;
  const interval = choice && typeof choice === 'object' && 'interval' in choice ? choice.interval : undefined;
  if (!isProTier(tier) || !isBillingInterval(interval) || typeof nonce !== 'string') {
    return { ok: false, error: NOT_OFFERED };
  }
  let url: string;
  try {
    url = await (await proRestart()).createProRestartCheckout(gate.tenantId, { tier, interval }, nonce);
  } catch (err) {
    console.error('[startProRestart]', err instanceof Error ? err.name : 'Error');
    if (err instanceof Error && err.message === 'managed') return { ok: false, error: MANAGED_ERROR };
    return { ok: false, error: RESTART_ERROR };
  }
  redirect(url);
}

/** A business made from a worker invite can have Lite but not Rounds (it would give the same login a second worker record). */
async function refusesRounds(tenantId: string, choice: PlanChoice): Promise<boolean> {
  return choice.plan !== 'lite' && (await isWorkerBusiness(tenantId));
}

export async function previewPlanChangeAction(target: unknown) {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  const choice = asChoice(target);
  if (!choice) return { ok: false as const, error: NOT_OFFERED };
  if (await refusesRounds(gate.tenantId, choice)) return { ok: false as const, error: WORKER_NO_ROUNDS };
  return previewPlanChange(gate.tenantId, choice);
}

export async function changePlanAction(target: unknown, expectedTodayPence: number, nonce: string) {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  const choice = asChoice(target);
  if (!choice) return { ok: false as const, error: NOT_OFFERED };
  if (await refusesRounds(gate.tenantId, choice)) return { ok: false as const, error: WORKER_NO_ROUNDS };
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

// ── Pro (Stripe-billed) ────────────────────────────────────────────────────

export async function previewProUpgradeAction(target: unknown): Promise<ProUpgradePreview> {
  const gate = await adminTenant();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!isProTier(target)) return { ok: false, error: NOT_OFFERED };
  return (await proManage()).previewProUpgrade(gate.tenantId, target);
}

export async function upgradeProTierAction(input: {
  target: unknown;
  expectedTodayPence: unknown;
  nonce: unknown;
}): Promise<ProChangeResult> {
  const gate = await adminTenant();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!isProTier(input?.target) || typeof input?.expectedTodayPence !== 'number' || typeof input?.nonce !== 'string') {
    return { ok: false, error: NOT_OFFERED };
  }
  const { upgradeProTier } = await proManage();
  return refresh(await upgradeProTier(gate.tenantId, input.target, input.expectedTodayPence, input.nonce));
}

export async function previewProYearlyAction(): Promise<ProYearlyPreview> {
  const gate = await adminTenant();
  if (!gate.ok) return { ok: false, error: gate.error };
  return (await proManage()).previewProYearly(gate.tenantId);
}

export async function switchProToYearlyAction(input: { expectedTodayPence: unknown; nonce: unknown }): Promise<ProChangeResult> {
  const gate = await adminTenant();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (typeof input?.expectedTodayPence !== 'number' || typeof input?.nonce !== 'string') {
    return { ok: false, error: NOT_OFFERED };
  }
  const { switchProToYearly } = await proManage();
  return refresh(await switchProToYearly(gate.tenantId, input.expectedTodayPence, input.nonce));
}

export async function cancelProPlanAction() {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  return refresh(await (await proManage()).cancelProPlan(gate.tenantId));
}

export async function undoProCancelAction() {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  return refresh(await (await proManage()).undoProCancel(gate.tenantId));
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

/**
 * A self-employed worker's business buys Lite at the worker price: sends them to Stripe Checkout.
 * Only the interval and a fresh nonce come from the browser; the price and coupon are the server's.
 */
export async function startWorkerLiteCheckoutAction(input: {
  interval: unknown;
  nonce: unknown;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const gate = await adminTenant();
  if (!gate.ok) return gate;
  if (!isBillingInterval(input?.interval) || typeof input?.nonce !== 'string') {
    return { ok: false, error: WORKER_LITE_ERROR };
  }
  try {
    const url = await createWorkerLiteCheckout(gate.tenantId, input.interval, input.nonce);
    return { ok: true, url };
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    console.error('[startWorkerLiteCheckout]', message.startsWith('gate:') ? message : err instanceof Error ? err.name : 'Error');
    if (message.startsWith('gate:')) {
      const reason = message.slice(5) as keyof typeof GATE_MESSAGE;
      return { ok: false, error: GATE_MESSAGE[reason] ?? WORKER_LITE_ERROR };
    }
    return { ok: false, error: WORKER_LITE_ERROR };
  }
}
