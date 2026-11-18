import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { TEXT_PACKS, textPackByKey, type TextPackKey } from '@/lib/messaging/credits';
import { ensureStripeCustomerId } from '@/lib/messaging/text-packs';
import { getAppUrl, getStripe } from '@/lib/stripe/client';

/**
 * Auto top-up settings: which pack, when it kicks in, the trader's own monthly spending limit, and
 * the saved card. Nothing is charged here (run-auto-top-up.ts does that). Off by default.
 */

export const TRIGGER_MIN = 5;
export const TRIGGER_MAX = 200;
export const TRIGGER_SUGGESTED = 20;
export const CAP_SUGGESTED_POUNDS = 50;
export const CAP_MAX_POUNDS = 1000;
export const PROMPT_MAX_DISMISSALS = 2;

export type AutoTopUpPausedReason = 'card_failed' | 'needs_authentication' | 'no_card';

export type AutoTopUpRow = {
  tenant_id: string;
  enabled: boolean;
  pack_key: TextPackKey;
  trigger_left: number;
  monthly_cap_pence: number;
  prompt_dismissed_count: number;
  payment_method_id: string | null;
  paused_reason: AutoTopUpPausedReason | null;
};

export type AutoTopUpSettings = {
  enabled: boolean;
  packKey: TextPackKey;
  triggerLeft: number;
  monthlyCapPence: number;
  pausedReason: AutoTopUpPausedReason | null;
  card: { brand: string; last4: string } | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function poundsLabel(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

export async function getAutoTopUp(admin: SupabaseClient, tenantId: string): Promise<AutoTopUpRow | null> {
  const { data, error } = await admin
    .from('text_auto_topup')
    .select(
      'tenant_id, enabled, pack_key, trigger_left, monthly_cap_pence, prompt_dismissed_count, payment_method_id, paused_reason',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AutoTopUpRow | null) ?? null;
}

export function validateAutoTopUpInput(i: {
  packKey: string;
  triggerLeft: number;
  monthlyCapPounds: number;
}):
  | { ok: true; value: { packKey: TextPackKey; triggerLeft: number; monthlyCapPence: number } }
  | { ok: false; error: string } {
  const pack = textPackByKey(i.packKey);
  if (!pack) return { ok: false, error: 'Pick a pack' };
  if (!Number.isInteger(i.triggerLeft) || i.triggerLeft < TRIGGER_MIN || i.triggerLeft > TRIGGER_MAX) {
    return { ok: false, error: `Choose a number between ${TRIGGER_MIN} and ${TRIGGER_MAX}` };
  }
  if (!Number.isInteger(i.monthlyCapPounds) || i.monthlyCapPounds < 1) {
    return { ok: false, error: 'Enter your monthly limit in whole pounds' };
  }
  if (i.monthlyCapPounds > CAP_MAX_POUNDS) {
    return { ok: false, error: `The most you can set is £${CAP_MAX_POUNDS.toLocaleString('en-GB')}` };
  }
  const capPence = i.monthlyCapPounds * 100;
  if (capPence < pack.pricePence) {
    return {
      ok: false,
      error: `Your limit must cover at least one pack (£${Math.ceil(pack.pricePence / 100)})`,
    };
  }
  return { ok: true, value: { packKey: pack.key, triggerLeft: i.triggerLeft, monthlyCapPence: capPence } };
}

export type ChargeableCard = { id: string; brand: string; last4: string; customerId: string };

function cardOf(pm: Stripe.PaymentMethod, customerId: string): ChargeableCard | null {
  if (!pm.card) return null;
  const owner = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id;
  if (owner !== customerId) return null;
  return { id: pm.id, brand: pm.card.brand, last4: pm.card.last4, customerId };
}

/**
 * The card that would be charged, or null. The stored payment method first, then the customer's
 * default, then their newest saved card. Throws on a Stripe error (callers say "could not check").
 */
export async function findChargeableCard(admin: SupabaseClient, tenantId: string): Promise<ChargeableCard | null> {
  const { data: tenant, error } = await admin
    .from('tenants')
    .select('stripe_customer_id')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const customerId = typeof tenant?.stripe_customer_id === 'string' ? tenant.stripe_customer_id : null;
  if (!customerId) return null;

  const stripe = getStripe();
  const row = await getAutoTopUp(admin, tenantId);

  if (row?.payment_method_id) {
    try {
      const card = cardOf(await stripe.paymentMethods.retrieve(row.payment_method_id), customerId);
      if (card) return card;
    } catch {
      // The saved method is gone (removed in Stripe): fall through to the others.
    }
  }

  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return null;
  const def = customer.invoice_settings?.default_payment_method;
  const defId = typeof def === 'string' ? def : def?.id;
  if (defId) {
    try {
      const card = cardOf(await stripe.paymentMethods.retrieve(defId), customerId);
      if (card) return card;
    } catch {
      // fall through
    }
  }

  const list = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
  const first = list.data[0];
  return first ? cardOf(first, customerId) : null;
}

export async function readAutoTopUpSettings(admin: SupabaseClient, tenantId: string): Promise<AutoTopUpSettings> {
  const row = await getAutoTopUp(admin, tenantId);
  let card: AutoTopUpSettings['card'] = null;
  try {
    const c = await findChargeableCard(admin, tenantId);
    card = c ? { brand: c.brand, last4: c.last4 } : null;
  } catch (err) {
    console.error('[readAutoTopUpSettings] card', err instanceof Error ? err.message : String(err));
  }
  return {
    enabled: row?.enabled ?? false,
    packKey: row?.pack_key ?? TEXT_PACKS[0].key,
    triggerLeft: row?.trigger_left ?? TRIGGER_SUGGESTED,
    monthlyCapPence: row?.monthly_cap_pence ?? CAP_SUGGESTED_POUNDS * 100,
    pausedReason: row?.paused_reason ?? null,
    card,
  };
}

/** Never throws. Saves the settings first (off), then turns it on if a card exists, else asks for one. */
export async function enableAutoTopUp(
  admin: SupabaseClient,
  tenantId: string,
  userEmail: string | null,
  input: { packKey: string; triggerLeft: number; monthlyCapPounds: number },
): Promise<{ ok: true } | { needsCard: true; url: string } | { error: string }> {
  try {
    const checked = validateAutoTopUpInput(input);
    if (!checked.ok) return { error: checked.error };
    const v = checked.value;

    const { error: saveError } = await admin.from('text_auto_topup').upsert(
      {
        tenant_id: tenantId,
        pack_key: v.packKey,
        trigger_left: v.triggerLeft,
        monthly_cap_pence: v.monthlyCapPence,
      },
      { onConflict: 'tenant_id' },
    );
    if (saveError) return { error: 'Could not save your settings. Try again.' };

    let card: ChargeableCard | null;
    try {
      card = await findChargeableCard(admin, tenantId);
    } catch (err) {
      console.error('[enableAutoTopUp] card', err instanceof Error ? err.message : String(err));
      return { error: 'Could not check your card. Try again.' };
    }

    if (card) {
      const { error } = await admin
        .from('text_auto_topup')
        .update({
          enabled: true,
          enabled_at: new Date().toISOString(),
          paused_reason: null,
          paused_at: null,
          prompt_dismissed_count: 0,
          payment_method_id: card.id,
        })
        .eq('tenant_id', tenantId);
      if (error) return { error: 'Could not turn it on. Try again.' };
      return { ok: true };
    }

    const ensured = await ensureStripeCustomerId(admin, tenantId, userEmail);
    if ('error' in ensured) return { error: ensured.error };
    const appUrl = getAppUrl();
    const session = await getStripe().checkout.sessions.create({
      mode: 'setup',
      customer: ensured.customerId,
      payment_method_types: ['card'],
      metadata: { kind: 'text_topup_card', tenant_id: tenantId, enable: '1' },
      setup_intent_data: { metadata: { kind: 'text_topup_card', tenant_id: tenantId } },
      success_url: `${appUrl}/messages?autotopup=card-saved`,
      cancel_url: `${appUrl}/messages`,
    });
    if (!session.url) return { error: 'Could not start the card page. Try again.' };
    return { needsCard: true, url: session.url };
  } catch (err) {
    console.error('[enableAutoTopUp]', err instanceof Error ? err.message : String(err));
    return { error: 'Something went wrong. Try again.' };
  }
}

/** Keeps the settings; nothing already in flight is cancelled. */
export async function disableAutoTopUp(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ ok: true } | { error: string }> {
  const { error } = await admin.from('text_auto_topup').update({ enabled: false }).eq('tenant_id', tenantId);
  return error ? { error: 'Could not turn it off. Try again.' } : { ok: true };
}

/** After the card is fixed: clear the pause. */
export async function resumeAutoTopUp(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const card = await findChargeableCard(admin, tenantId);
    if (!card) return { error: 'There is still no card on file.' };
    const { error } = await admin
      .from('text_auto_topup')
      .update({ paused_reason: null, paused_at: null, payment_method_id: card.id })
      .eq('tenant_id', tenantId);
    return error ? { error: 'Could not resume. Try again.' } : { ok: true };
  } catch (err) {
    console.error('[resumeAutoTopUp]', err instanceof Error ? err.message : String(err));
    return { error: 'Could not check your card. Try again.' };
  }
}

/** "Not now" on the prompt. Counts at most twice (optimistic update, so two taps cannot count past it). */
export async function dismissAutoTopUpPrompt(admin: SupabaseClient, tenantId: string): Promise<void> {
  try {
    const row = await getAutoTopUp(admin, tenantId);
    if (!row) {
      await admin
        .from('text_auto_topup')
        .upsert({ tenant_id: tenantId, prompt_dismissed_count: 1 }, { onConflict: 'tenant_id', ignoreDuplicates: true });
      return;
    }
    if (row.prompt_dismissed_count >= PROMPT_MAX_DISMISSALS) return;
    await admin
      .from('text_auto_topup')
      .update({ prompt_dismissed_count: row.prompt_dismissed_count + 1 })
      .eq('tenant_id', tenantId)
      .eq('prompt_dismissed_count', row.prompt_dismissed_count);
  } catch (err) {
    console.error('[dismissAutoTopUpPrompt]', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Webhook branch: a setup-mode Checkout finished. Stores the card (its pm_ id only) and, if the trader
 * asked to turn auto top-up on, turns it on. Throws on database errors so Stripe retries.
 */
export async function saveCardFromSetupSession(admin: SupabaseClient, session: Stripe.Checkout.Session): Promise<boolean> {
  if (session.mode !== 'setup' || session.metadata?.kind !== 'text_topup_card') return false;
  const tenantId = session.metadata?.tenant_id ?? '';
  if (!UUID_RE.test(tenantId)) return false;

  const customerRef = session.customer;
  const customerId = typeof customerRef === 'string' ? customerRef : customerRef?.id ?? null;
  if (!customerId) return false;

  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('id, stripe_customer_id')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantError) throw new Error(tenantError.message);
  if (!tenant || tenant.stripe_customer_id !== customerId) {
    console.error('[saveCardFromSetupSession] refused', { tenant_id: tenantId, session_id: session.id });
    return false;
  }

  const intentRef = session.setup_intent;
  const intentId = typeof intentRef === 'string' ? intentRef : intentRef?.id;
  if (!intentId) return false;
  const intent = await getStripe().setupIntents.retrieve(intentId);
  const pmRef = intent.payment_method;
  const pmId = typeof pmRef === 'string' ? pmRef : pmRef?.id;
  if (!pmId) return false;

  const patch: Record<string, unknown> = { tenant_id: tenantId, payment_method_id: pmId };
  if (session.metadata?.enable === '1') {
    patch.enabled = true;
    patch.enabled_at = new Date().toISOString();
    patch.paused_reason = null;
    patch.paused_at = null;
    patch.prompt_dismissed_count = 0;
  }
  const { error } = await admin.from('text_auto_topup').upsert(patch, { onConflict: 'tenant_id' });
  if (error) throw new Error(error.message);
  return true;
}

export function autoTopUpSummaryLine(row: AutoTopUpRow, card: { last4: string } | null): string {
  const pack = textPackByKey(row.pack_key);
  const price = pack ? ` (${poundsLabel(pack.pricePence)})` : '';
  return `When you drop to ${row.trigger_left} texts, we buy ${pack?.label ?? 'a pack'}${price}${
    card ? ` from your card ending ${card.last4}` : ''
  }. At most one a day, never more than ${poundsLabel(row.monthly_cap_pence)} a month.`;
}
