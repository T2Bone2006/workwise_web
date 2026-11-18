import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { buildAutoTopUpFailedEmail, buildAutoTopUpReceiptEmail } from '@/lib/emails/auto-top-up';
import { ownerEmailFor, sendOwnerEmail } from '@/lib/emails/owner-notice';
import { findChargeableCard, getAutoTopUp, type AutoTopUpPausedReason } from '@/lib/messaging/auto-top-up';
import { summariseTexts, textPackByKey } from '@/lib/messaging/credits';
import { isQuietHours, londonMonth } from '@/lib/messaging/london-time';
import { releaseWaitingForTenant } from '@/lib/messaging/release-waiting';
import { listRoundsTenantIds } from '@/lib/messaging/rounds-tenants';
import { textAllowanceFor } from '@/lib/messaging/text-allowance';
import { todayInLondon } from '@/lib/rounds/dates';
import { getAppUrl, getStripe } from '@/lib/stripe/client';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Auto top-up: when a business that turned it on falls to its trigger, buy one pack from its saved
 * card. Safety, in order: the day is CLAIMED (a unique row per business per day) before Stripe is
 * called; the monthly spend is checked first; the amount comes from the server's pack list and is
 * checked against the Stripe Price; a failed card pauses it and nothing is retried.
 *
 * Leaf of send.ts: send.ts reaches this through a dynamic import, and nothing here imports send.ts
 * directly (release-waiting does, one way).
 */

export type AutoTopUpResult =
  | {
      result:
        | 'not_needed'
        | 'off'
        | 'paused'
        | 'already_today'
        | 'cap_reached'
        | 'no_card'
        | 'quiet_hours'
        | 'not_entitled';
    }
  | { result: 'charged'; texts: number; amountPence: number }
  | { result: 'failed'; reason: 'card_failed' | 'needs_authentication' | 'price_mismatch' | 'unknown' };

const RECONCILE_AFTER_MS = 10 * 60 * 1000;
const GIVE_UP_AFTER_MS = 60 * 60 * 1000;

function pounds(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

function brandLabel(brand: string, last4: string): string {
  const name = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'your card';
  return `${name} card ending ${last4}`;
}

async function textsLeft(admin: SupabaseClient, tenantId: string, now: Date): Promise<number> {
  const { data } = await admin
    .from('tenant_text_balance')
    .select('month, month_used, pack_balance')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return summariseTexts(
    data as { month: string; month_used: number; pack_balance: number } | null,
    londonMonth(now),
    await textAllowanceFor(admin, tenantId),
  ).totalLeft;
}

async function spentThisMonth(admin: SupabaseClient, tenantId: string, month: string): Promise<number> {
  const { data, error } = await admin
    .from('text_auto_topup_charges')
    .select('amount_pence')
    .eq('tenant_id', tenantId)
    .eq('month', month)
    .in('status', ['pending', 'paid']);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, r) => sum + Number((r as { amount_pence: number }).amount_pence), 0);
}

async function pauseAndTell(
  admin: SupabaseClient,
  tenantId: string,
  reason: AutoTopUpPausedReason,
  now: Date,
): Promise<void> {
  await admin
    .from('text_auto_topup')
    .update({ paused_reason: reason, paused_at: now.toISOString() })
    .eq('tenant_id', tenantId);
  try {
    const to = await ownerEmailFor(admin, tenantId);
    if (to) {
      await sendOwnerEmail({
        to,
        idempotencyKey: `autotopup-failed-${tenantId}-${now.toISOString()}`,
        content: buildAutoTopUpFailedEmail({
          reason,
          buyUrl: `${getAppUrl()}/messages`,
          settingsUrl: `${getAppUrl()}/messages#auto-top-up`,
        }),
      });
    }
  } catch (err) {
    console.error('[autoTopUp] failed email', err instanceof Error ? err.message : String(err));
  }
}

type ChargeRow = {
  id: string;
  tenant_id: string;
  pack_key: string;
  texts: number;
  amount_pence: number;
  month: string;
};

/**
 * The money has arrived: add the texts exactly once (add_text_pack is idempotent on the PaymentIntent
 * id), mark the row paid, release anything waiting, send the receipt. Returns true when the texts were
 * added now. Throws only if the credit itself could not be recorded (the row then stays pending and the
 * reconcile pass finishes it).
 */
async function finishPaid(
  admin: SupabaseClient,
  row: ChargeRow,
  intentId: string,
  card: { brand: string; last4: string } | null,
  now: Date,
): Promise<boolean> {
  const { data: credited, error } = await admin.rpc('add_text_pack', {
    p_tenant_id: row.tenant_id,
    p_pack_key: row.pack_key,
    p_texts: row.texts,
    p_amount_pence: row.amount_pence,
    p_checkout_session_id: intentId,
    p_payment_intent_id: intentId,
  });
  if (error) throw new Error(error.message);

  const { error: markError } = await admin
    .from('text_auto_topup_charges')
    .update({ status: 'paid', stripe_payment_intent_id: intentId })
    .eq('id', row.id);
  if (markError) console.error('[autoTopUp] mark paid', markError.message);

  if (credited === true) {
    try {
      await releaseWaitingForTenant(admin, row.tenant_id, now);
    } catch (err) {
      console.error('[autoTopUp] release', err instanceof Error ? err.message : String(err));
    }
    try {
      const to = await ownerEmailFor(admin, row.tenant_id);
      const pack = textPackByKey(row.pack_key);
      if (to && pack) {
        const settings = await getAutoTopUp(admin, row.tenant_id);
        await sendOwnerEmail({
          to,
          idempotencyKey: `autotopup-receipt-${intentId}`,
          content: buildAutoTopUpReceiptEmail({
            packLabel: pack.label,
            texts: row.texts,
            amountLabel: pounds(row.amount_pence),
            cardLabel: card ? brandLabel(card.brand, card.last4) : 'your saved card',
            textsNow: await textsLeft(admin, row.tenant_id, now),
            spentThisMonthLabel: pounds(await spentThisMonth(admin, row.tenant_id, row.month)),
            limitLabel: pounds(settings?.monthly_cap_pence ?? 0),
            settingsUrl: `${getAppUrl()}/messages#auto-top-up`,
          }),
        });
      }
    } catch (err) {
      console.error('[autoTopUp] receipt', err instanceof Error ? err.message : String(err));
    }
    try {
      const { checkTextWarnings } = await import('@/lib/messaging/low-texts');
      await checkTextWarnings(admin, row.tenant_id, now);
    } catch {
      // never fails a top-up
    }
  }
  return credited === true;
}

/** Never throws. */
export async function maybeAutoTopUp(
  admin: SupabaseClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<AutoTopUpResult> {
  try {
    const settings = await getAutoTopUp(admin, tenantId);
    if (!settings || !settings.enabled) return { result: 'off' };
    if (settings.paused_reason) return { result: 'paused' };

    const left = await textsLeft(admin, tenantId, now);
    if (left > settings.trigger_left) return { result: 'not_needed' };

    if (isQuietHours(now)) return { result: 'quiet_hours' };

    const entitled = new Set(await listRoundsTenantIds(admin));
    if (!entitled.has(tenantId)) return { result: 'not_entitled' };

    const pack = textPackByKey(settings.pack_key);
    if (!pack) return { result: 'failed', reason: 'unknown' };

    const card = await findChargeableCard(admin, tenantId);
    if (!card) {
      await pauseAndTell(admin, tenantId, 'no_card', now);
      return { result: 'no_card' };
    }

    // The amount we are about to charge must be the price Stripe has for this pack.
    const priceId = process.env[pack.priceEnv];
    if (!priceId) return { result: 'failed', reason: 'price_mismatch' };
    const price = await getStripe().prices.retrieve(priceId);
    if (price.unit_amount !== pack.pricePence || price.currency !== 'gbp') {
      console.error('[autoTopUp] price mismatch', { pack: pack.key });
      return { result: 'failed', reason: 'price_mismatch' };
    }

    const month = londonMonth(now);
    const dayKey = todayInLondon(now);
    if ((await spentThisMonth(admin, tenantId, month)) + pack.pricePence > settings.monthly_cap_pence) {
      return { result: 'cap_reached' };
    }

    // Claim today. A second runner (or a second dip the same day) loses here, before Stripe is called.
    const { data: claimed, error: claimError } = await admin
      .from('text_auto_topup_charges')
      .insert({
        tenant_id: tenantId,
        day_key: dayKey,
        month,
        pack_key: pack.key,
        texts: pack.texts,
        amount_pence: pack.pricePence,
        status: 'pending',
      })
      .select('id')
      .single();
    if (claimError) {
      if (claimError.code === '23505') return { result: 'already_today' };
      console.error('[autoTopUp] claim', claimError.message);
      return { result: 'failed', reason: 'unknown' };
    }
    const row: ChargeRow = {
      id: (claimed as { id: string }).id,
      tenant_id: tenantId,
      pack_key: pack.key,
      texts: pack.texts,
      amount_pence: pack.pricePence,
      month,
    };

    let intent: Stripe.PaymentIntent;
    try {
      intent = await getStripe().paymentIntents.create(
        {
          amount: pack.pricePence,
          currency: 'gbp',
          customer: card.customerId,
          payment_method: card.id,
          off_session: true,
          confirm: true,
          description: 'WorkWise texts auto top-up',
          metadata: {
            kind: 'text_pack',
            source: 'auto_top_up',
            tenant_id: tenantId,
            pack_key: pack.key,
            charge_id: row.id,
          },
        },
        // One key per claimed charge row: a retry of THIS charge is harmless, and an unrelated earlier charge can never collide with it.
        { idempotencyKey: `autotopup:${row.id}` },
      );
    } catch (err) {
      const e = err as { type?: string; code?: string; message?: string; payment_intent?: { id?: string } };
      if (e.type === 'StripeCardError') {
        const reason: AutoTopUpPausedReason = e.code === 'authentication_required' ? 'needs_authentication' : 'card_failed';
        await admin
          .from('text_auto_topup_charges')
          .update({ status: 'failed', error: e.code ?? 'card_error', stripe_payment_intent_id: e.payment_intent?.id ?? null })
          .eq('id', row.id);
        await pauseAndTell(admin, tenantId, reason, now);
        return { result: 'failed', reason };
      }
      // A network or unknown Stripe error: we do not know if the card was charged. Leave it pending;
      // the reconcile pass looks it up.
      console.error('[autoTopUp] stripe', e.message ?? 'error');
      return { result: 'failed', reason: 'unknown' };
    }

    await admin.from('text_auto_topup_charges').update({ stripe_payment_intent_id: intent.id }).eq('id', row.id);

    if (intent.status === 'succeeded') {
      try {
        await finishPaid(admin, row, intent.id, card, now);
      } catch (err) {
        // The card was charged but the texts were not recorded: stays pending, reconcile finishes it.
        console.error('[autoTopUp] credit', err instanceof Error ? err.message : String(err));
        return { result: 'failed', reason: 'unknown' };
      }
      return { result: 'charged', texts: pack.texts, amountPence: pack.pricePence };
    }

    // requires_action / requires_payment_method: the bank wants the customer. No retry.
    try {
      await getStripe().paymentIntents.cancel(intent.id);
    } catch {
      // already final
    }
    const reason: AutoTopUpPausedReason = intent.status === 'requires_action' ? 'needs_authentication' : 'card_failed';
    await admin
      .from('text_auto_topup_charges')
      .update({ status: 'failed', error: intent.status })
      .eq('id', row.id);
    await pauseAndTell(admin, tenantId, reason, now);
    return { result: 'failed', reason };
  } catch (err) {
    console.error('[maybeAutoTopUp]', err instanceof Error ? err.message : String(err));
    return { result: 'failed', reason: 'unknown' };
  }
}

/** Finish charges left pending (a crash or a network error mid-charge). Never throws. */
async function reconcilePending(admin: SupabaseClient, now: Date): Promise<number> {
  let done = 0;
  try {
    const cutoff = new Date(now.getTime() - RECONCILE_AFTER_MS).toISOString();
    const { data, error } = await admin
      .from('text_auto_topup_charges')
      .select('id, tenant_id, pack_key, texts, amount_pence, month, stripe_payment_intent_id, created_at')
      .eq('status', 'pending')
      .lte('created_at', cutoff)
      .limit(50);
    if (error) {
      console.error('[autoTopUp] reconcile list', error.message);
      return 0;
    }
    for (const raw of data ?? []) {
      const row = raw as ChargeRow & { stripe_payment_intent_id: string | null; created_at: string };
      try {
        let intent: Stripe.PaymentIntent | null = null;
        if (row.stripe_payment_intent_id) {
          intent = await getStripe().paymentIntents.retrieve(row.stripe_payment_intent_id);
        } else {
          const found = await getStripe().paymentIntents.search({
            query: `metadata['charge_id']:'${row.id}'`,
            limit: 1,
          });
          intent = found.data[0] ?? null;
        }
        if (intent?.status === 'succeeded') {
          await finishPaid(admin, row, intent.id, null, now);
          done += 1;
        } else if (intent && ['requires_payment_method', 'canceled'].includes(intent.status)) {
          await admin.from('text_auto_topup_charges').update({ status: 'failed', error: intent.status }).eq('id', row.id);
        } else if (!intent && now.getTime() - new Date(row.created_at).getTime() > GIVE_UP_AFTER_MS) {
          // Nothing was ever charged for this claim.
          await admin.from('text_auto_topup_charges').update({ status: 'failed', error: 'not_found' }).eq('id', row.id);
        }
      } catch (err) {
        console.error('[autoTopUp] reconcile', err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    console.error('[autoTopUp] reconcile', err instanceof Error ? err.message : String(err));
  }
  return done;
}

/** Cron: every business with auto top-up on, then finish anything left pending. Never throws. */
export async function sweepAutoTopUps(
  now: Date = new Date(),
): Promise<{ checked: number; charged: number; reconciled: number }> {
  const out = { checked: 0, charged: 0, reconciled: 0 };
  try {
    const admin = createAdminClient();
    out.reconciled = await reconcilePending(admin, now);
    const { data, error } = await admin
      .from('text_auto_topup')
      .select('tenant_id')
      .eq('enabled', true)
      .is('paused_reason', null)
      .limit(1000);
    if (error) {
      console.error('[sweepAutoTopUps]', error.message);
      return out;
    }
    for (const r of data ?? []) {
      const res = await maybeAutoTopUp(admin, (r as { tenant_id: string }).tenant_id, now);
      out.checked += 1;
      if (res.result === 'charged') out.charged += 1;
    }
  } catch (err) {
    console.error('[sweepAutoTopUps]', err instanceof Error ? err.message : String(err));
  }
  return out;
}
