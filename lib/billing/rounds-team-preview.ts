import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { choiceForPriceId } from '@/lib/billing/plans';
import {
  chargeNowFromPreviewLines,
  isProrationLine,
  stripeNowUnix,
  type PreviewLine,
} from '@/lib/billing/stripe-preview-lines';
import { isRoundsTeamPrice, teamPriceIdFor, teamPricePence } from '@/lib/billing/rounds-team-core';
import { countLeads } from '@/lib/billing/rounds-team';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import { getStripe } from '@/lib/stripe/client';
import { createAdminClient } from '@/lib/supabase/admin';

export type RoundsTeamPreview =
  | {
      ok: true;
      interval: 'month' | 'year';
      perLeadPence: number;
      /** Yearly only: what is charged today for the rest of the year, from Stripe's own preview. Monthly: null. */
      chargeNowPence: number | null;
      firstBillNote: string;
    }
  | { ok: false; reason: string };

/**
 * What adding `adding` leads would cost today. Read-only: nothing is created. Never throws: any problem is
 * { ok: false } and the invite step then shows the plain price without the exact pro-rata figure.
 */
export async function previewRoundsTeamCharge(
  tenantId: string,
  adding: number,
  client?: SupabaseClient,
): Promise<RoundsTeamPreview> {
  try {
    if (!Number.isFinite(adding) || adding <= 0) return { ok: false, reason: 'nothing to add' };
    const db = client ?? createAdminClient();

    const { data, error } = await db
      .from('subscriptions')
      .select('stripe_subscription_id, source, status')
      .eq('tenant_id', tenantId)
      .eq('product', 'rounds')
      .in('status', [...ENTITLED_STATUSES]);
    if (error || !Array.isArray(data)) return { ok: false, reason: 'could not read the subscription' };
    const row = (data as Array<{ stripe_subscription_id: string | null; source: string }>).find(
      (r) => r.source === 'stripe' && r.stripe_subscription_id,
    );
    if (!row?.stripe_subscription_id) return { ok: false, reason: 'not billed through Stripe' };

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const planItem = subscription.items.data.find((i) => choiceForPriceId(i.price.id));
    const planChoice = planItem ? choiceForPriceId(planItem.price.id) : null;
    if (!planItem || !planChoice) return { ok: false, reason: 'plan line not recognised' };

    const interval = planChoice.interval;
    const perLeadPence = teamPricePence(interval);
    if (interval === 'month') {
      return { ok: true, interval, perLeadPence, chargeNowPence: null, firstBillNote: 'Pro-rated onto your next bill.' };
    }

    const leads = await countLeads(tenantId, db);
    if (leads === null) return { ok: false, reason: 'could not count leads' };
    const priceId = teamPriceIdFor(interval);
    const existing = subscription.items.data.find((i) => isRoundsTeamPrice(i.price.id));
    if (!existing && !priceId) return { ok: false, reason: 'team prices not configured' };

    const quantity = leads + Math.floor(adding);
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const preview = await stripe.invoices.createPreview({
      customer: customerId,
      subscription: subscription.id,
      subscription_details: {
        items: [existing ? { id: existing.id, quantity } : { price: priceId as string, quantity }],
        proration_behavior: 'always_invoice',
        proration_date: await stripeNowUnix(stripe, subscription),
      },
    });
    const chargeNowPence = chargeNowFromPreviewLines(
      (preview.lines?.data ?? []).map((line) => ({
        amount: (line as PreviewLine).amount ?? 0,
        proration: isProrationLine(line as PreviewLine),
      })),
    );
    return {
      ok: true,
      interval,
      perLeadPence,
      chargeNowPence,
      firstBillNote: 'Charged today for the rest of your year, then £100 a year.',
    };
  } catch (err) {
    console.error('[rounds-team-preview]', err instanceof Error ? err.name : 'Error');
    return { ok: false, reason: 'preview failed' };
  }
}
