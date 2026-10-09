import 'server-only';

import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { countTeamWorkers } from '@/lib/data/workers';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import { getStripe } from '@/lib/stripe/client';
import { paidForWorkers } from '@/lib/billing/extra-workers-core';
import type { TenantSettings } from '@/lib/data/settings-types';
import {
  PRO_TIER_ORDER,
  computeAllowance,
  type Allowance,
  type ExtraWorkerNotice,
  type ProTier,
} from '@/lib/billing/pro-allowance';

export type ProSubscriptionRow = {
  product: string;
  source: string;
  status: string;
  stripe_subscription_id: string | null;
  billing_interval?: 'month' | 'year' | null;
  included_workers_override?: number | null;
};

/**
 * The business's live Pro-tier subscription row (the highest tier if more than one), or null.
 * Pass the admin client when there is no signed-in user.
 */
export async function loadProSubscription(
  tenantId: string,
  client?: SupabaseClient
): Promise<ProSubscriptionRow | null> {
  const supabase = client ?? (await createClient());
  const build = (columns: string) =>
    supabase
      .from('subscriptions')
      .select(columns)
      .eq('tenant_id', tenantId)
      .in('product', [...PRO_TIER_ORDER])
      .in('status', [...ENTITLED_STATUSES])
      .returns<ProSubscriptionRow[]>();

  let rows: ProSubscriptionRow[];
  const first = await build('product, source, status, stripe_subscription_id, billing_interval, included_workers_override');
  if (!first.error) {
    rows = first.data ?? [];
  } else {
    // included_workers_override is added by a migration the owner pastes by hand. Until it exists, read without it.
    const second = await build('product, source, status, stripe_subscription_id, billing_interval');
    if (second.error) {
      console.error('[worker-allowance] subscriptions:', second.error.message);
      return null;
    }
    rows = second.data ?? [];
  }
  if (rows.length === 0) return null;

  // Highest tier wins if more than one is somehow live.
  return [...rows].sort(
    (a, b) =>
      PRO_TIER_ORDER.indexOf(b.product as ProTier) - PRO_TIER_ORDER.indexOf(a.product as ProTier),
  )[0];
}

export function allowanceFor(row: ProSubscriptionRow, used: number, paidFor: number | null = null): Allowance {
  return computeAllowance({
    tier: row.product as ProTier,
    source: row.source === 'manual' ? 'manual' : 'stripe',
    includedOverride: row.included_workers_override ?? null,
    interval: row.billing_interval === 'year' ? 'year' : row.billing_interval === 'month' ? 'month' : null,
    used,
    paidFor,
  });
}

/**
 * The team size already paid for at sign-up (extras billed up front), or null. The sign-up stores the size on the
 * business's settings and on the Stripe subscription; Stripe's copy is cleared once the team reaches it, so it is
 * the one believed. Stripe is only asked while the team is still smaller than the size said at sign-up.
 * `gateUsed` is the team size to judge "still smaller" by (default: `used`). Any failure gives null, which only
 * means extras follow headcount.
 */
export async function loadPaidForWorkers(
  tenantId: string,
  row: ProSubscriptionRow,
  gateUsed: number,
  client?: SupabaseClient
): Promise<number | null> {
  try {
    if (row.source === 'manual' || !row.stripe_subscription_id) return null;
    const supabase = client ?? (await createClient());
    const { data } = await supabase.from('tenants').select('settings').eq('id', tenantId).maybeSingle();
    const expected = (data?.settings as TenantSettings | null)?.onboarding?.expected_workers;
    if (typeof expected !== 'number' || gateUsed >= expected) return null;
    const subscription = await getStripe().subscriptions.retrieve(row.stripe_subscription_id);
    return paidForWorkers(subscription.metadata);
  } catch {
    return null;
  }
}

/** The allowance including extras paid for at sign-up. `gateUsed` as in loadPaidForWorkers. */
export async function allowanceWithPaidFor(
  tenantId: string,
  row: ProSubscriptionRow,
  used: number,
  client?: SupabaseClient,
  gateUsed: number = used
): Promise<Allowance> {
  const paidFor = await loadPaidForWorkers(tenantId, row, gateUsed, client);
  return allowanceFor(row, used, paidFor);
}

/**
 * The worker allowance for a business, or null when it has no Pro tier (or we
 * could not tell). Null means "do not block anything": a lookup failure must
 * never stop someone adding a worker.
 */
export async function loadWorkerAllowance(
  tenantId: string,
  client?: SupabaseClient
): Promise<Allowance | null> {
  const row = await loadProSubscription(tenantId, client);
  if (!row) return null;

  const used = await countTeamWorkers(tenantId, { includePending: true }, client);
  if (used === null) return null;

  return allowanceWithPaidFor(tenantId, row, used, client);
}

/** Per-request memoised allowance for the signed-in user's business (Workers page). */
export const getWorkerAllowance = cache(async (): Promise<Allowance | null> => {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return null;
  return loadWorkerAllowance(tenantId);
});

/**
 * Keeps a record that the account holder agreed to the extra-worker price.
 * The table is written only by the service role. A failure here is logged and
 * never undoes the worker that was just added.
 */
export async function recordExtraWorkerConsent(p: {
  tenantId: string;
  userId: string;
  workerId: string | null;
  notice: ExtraWorkerNotice;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('worker_allowance_confirmations').insert({
      tenant_id: p.tenantId,
      confirmed_by_user_id: p.userId,
      worker_id: p.workerId,
      tier: p.notice.tierName.toLowerCase(),
      worker_number: p.notice.workerNumber,
      included_workers: p.notice.included,
      // What the owner was shown and agreed to: £12 monthly, £120 yearly (the interval is on their subscription).
      extra_worker_pounds: p.notice.perWorkerPence / 100,
    });
    if (error) console.error('[worker-allowance] record consent:', error.message);
  } catch (err) {
    console.error('[worker-allowance] record consent:', err);
  }
}
