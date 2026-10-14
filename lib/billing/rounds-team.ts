import 'server-only';

import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { choiceForPriceId } from '@/lib/billing/plans';
import {
  leadsToBill,
  teamPriceIdFor,
  isRoundsTeamPrice,
} from '@/lib/billing/rounds-team-core';
import { planExtraWorkerChange, prorationFor, type ExtraWorkerLine } from '@/lib/billing/extra-workers-core';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import { getStripe } from '@/lib/stripe/client';
import { createAdminClient } from '@/lib/supabase/admin';

export {
  TEAM_HELPERS_FREE,
  TEAM_PRICE_LINE,
  TEAM_PRICE_LINE_YEARLY,
} from '@/lib/billing/rounds-team-core';

/**
 * Keeps the "Rounds team member" line on a Rounds business's Stripe subscription equal to the number of leads it has
 * (a lead is charged from the moment the invite is sent, so a pending invite counts). Same rules as the Pro
 * extra-worker line, because this changes what people are charged:
 * - Only Stripe-billed Rounds businesses are touched. Manual accounts and anything without a Stripe subscription never are.
 * - It only ever moves the team line. The plan line is never changed, and is found by price, never by position.
 * - If anything cannot be read (no price configured, can't count, Stripe error) it changes nothing and the next run tries again.
 *   It never throws into the code that added the lead.
 * - It is convergent: running it twice is harmless.
 */

const BILLABLE_STRIPE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export type RoundsTeamResult =
  | { outcome: 'unchanged' | 'added' | 'updated' | 'removed'; leads: number }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'error'; message: string };

/** Leads on the team: not ended, and their worker row not deactivated. Pending invites count. Null = could not tell. */
export async function countLeads(tenantId: string, client?: SupabaseClient): Promise<number | null> {
  const db = client ?? createAdminClient();
  const { data, error } = await db
    .from('team_people')
    .select('worker_id')
    .eq('tenant_id', tenantId)
    .eq('kind', 'lead')
    .is('ended_at', null);
  if (error || !Array.isArray(data)) {
    console.error('[rounds-team] count leads', error?.message);
    return null;
  }
  const workerIds = data.map((r) => (r as { worker_id: string | null }).worker_id).filter((id): id is string => Boolean(id));
  if (workerIds.length === 0) return 0;
  const { data: workers, error: workerError } = await db
    .from('workers')
    .select('id, invite_status')
    .in('id', workerIds);
  if (workerError || !Array.isArray(workers)) {
    console.error('[rounds-team] count workers', workerError?.message);
    return null;
  }
  return workers.filter((w) => (w as { invite_status?: string | null }).invite_status !== 'deactivated').length;
}

type RoundsSubscriptionRow = { stripe_subscription_id: string | null; source: string; status: string };

async function loadRoundsSubscription(db: SupabaseClient, tenantId: string): Promise<RoundsSubscriptionRow | null> {
  const { data, error } = await db
    .from('subscriptions')
    .select('stripe_subscription_id, source, status')
    .eq('tenant_id', tenantId)
    .eq('product', 'rounds')
    .in('status', [...ENTITLED_STATUSES]);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const rows = data as RoundsSubscriptionRow[];
  return rows.find((r) => r.source === 'stripe' && r.stripe_subscription_id) ?? rows[0];
}

export async function reconcileRoundsTeam(tenantId: string, client?: SupabaseClient): Promise<RoundsTeamResult> {
  try {
    const db = client ?? createAdminClient();

    const row = await loadRoundsSubscription(db, tenantId);
    if (!row) return { outcome: 'skipped', reason: 'no Rounds subscription' };
    if (row.source === 'manual' || !row.stripe_subscription_id) {
      return { outcome: 'skipped', reason: 'manual account' };
    }

    const leads = await countLeads(tenantId, db);
    if (leads === null) return { outcome: 'skipped', reason: 'could not count leads' };

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    if (!BILLABLE_STRIPE_STATUSES.has(subscription.status)) {
      return { outcome: 'skipped', reason: `subscription is ${subscription.status}` };
    }

    // The plan line is the one whose price is a known Rounds / Lite / bundle plan price; never "the first line".
    const planItem = subscription.items.data.find((i) => choiceForPriceId(i.price.id));
    const planChoice = planItem ? choiceForPriceId(planItem.price.id) : null;
    if (!planItem || !planChoice) return { outcome: 'skipped', reason: 'plan line not recognised' };
    const interval = planChoice.interval;

    const over = leadsToBill(leads);
    const wantedPriceId = teamPriceIdFor(interval);
    if (over > 0 && !wantedPriceId) {
      console.warn('[rounds-team] team price ids are not configured; changing nothing');
      return { outcome: 'skipped', reason: 'team prices not configured' };
    }

    const line = subscription.items.data.find((i) => isRoundsTeamPrice(i.price.id));
    const current: ExtraWorkerLine | null = line
      ? { itemId: line.id, priceId: line.price.id, quantity: line.quantity ?? 0 }
      : null;

    const action = planExtraWorkerChange({ over, wantedPriceId: wantedPriceId ?? '', current });
    const proration = prorationFor(interval);

    switch (action.kind) {
      case 'none':
        return { outcome: 'unchanged', leads };
      case 'add':
        await stripe.subscriptionItems.create({
          subscription: subscription.id,
          price: action.priceId,
          quantity: action.quantity,
          proration_behavior: proration,
        });
        return { outcome: 'added', leads };
      case 'set':
        await stripe.subscriptionItems.update(action.itemId, {
          price: action.priceId,
          quantity: action.quantity,
          proration_behavior: proration,
        });
        return { outcome: 'updated', leads };
      case 'remove':
        await stripe.subscriptionItems.del(action.itemId, { proration_behavior: proration });
        return { outcome: 'removed', leads };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[rounds-team] ${tenantId}:`, message);
    return { outcome: 'error', message };
  }
}

/**
 * Called after a lead is invited, removed or brought back. Runs after the response is sent so the page isn't kept
 * waiting on Stripe; if that isn't possible here, runs in line. Never throws.
 */
export function reconcileRoundsTeamAfterChange(tenantId: string | null | undefined): void {
  if (!tenantId) return;
  const run = async () => {
    await reconcileRoundsTeam(tenantId);
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Daily: every Stripe-billed Rounds business, so anything the live calls missed is put right. */
export async function reconcileAllRoundsTeams(): Promise<{
  checked: number;
  changed: number;
  skipped: number;
  errors: number;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('subscriptions')
    .select('tenant_id')
    .eq('source', 'stripe')
    .eq('product', 'rounds')
    .in('status', [...ENTITLED_STATUSES])
    .not('stripe_subscription_id', 'is', null);
  if (error) throw new Error(`[rounds-team] list failed: ${error.message}`);

  const tenantIds = Array.from(new Set((data ?? []).map((r) => (r as { tenant_id: string }).tenant_id)));
  const tally = { checked: 0, changed: 0, skipped: 0, errors: 0 };
  for (const tenantId of tenantIds) {
    tally.checked += 1;
    const result = await reconcileRoundsTeam(tenantId, admin);
    if (result.outcome === 'error') tally.errors += 1;
    else if (result.outcome === 'skipped') tally.skipped += 1;
    else if (result.outcome !== 'unchanged') tally.changed += 1;
  }
  return tally;
}
