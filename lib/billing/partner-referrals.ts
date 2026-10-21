import 'server-only';

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripe } from '@/lib/stripe/client';
import {
  collectedPence,
  normaliseSignupCode,
  outstandingPence,
  partnerWindowEnd,
  sharePence,
  type CountedInvoice,
} from '@/lib/billing/partner-share';

export type PartnerCode = { id: string; name: string; code: string };

/** An active partner with this code. Null when the code is unused, switched off, or the table is missing. */
export async function lookupPartner(code: string): Promise<PartnerCode | null> {
  const normalised = normaliseSignupCode(code);
  if (!normalised) return null;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('referral_partners')
      .select('id, name, code')
      .eq('code', normalised)
      .eq('active', true)
      .maybeSingle();
    if (error || !data) return null;
    if (typeof data.id !== 'string' || typeof data.name !== 'string' || typeof data.code !== 'string') return null;
    return { id: data.id, name: data.name, code: data.code };
  } catch {
    return null;
  }
}

/**
 * After the account exists. No-op when the signup was not a partner code, or when a customer
 * referral was also stored (that one wins and is paid as a free month on their bill).
 * A second run for the same business does nothing. Throws so Stripe retries the webhook.
 */
export async function recordPartnerReferral(args: {
  admin: SupabaseClient;
  intentId: string;
  tenantId: string;
}): Promise<void> {
  const { data, error } = await args.admin
    .from('signup_intents')
    .select('partner_id, referrer_tenant_id')
    .eq('id', args.intentId)
    .maybeSingle();
  if (error) throw new Error('partner referral lookup failed');
  const partnerId = typeof data?.partner_id === 'string' ? data.partner_id : null;
  if (!partnerId || data?.referrer_tenant_id) return;

  const { data: partner, error: partnerError } = await args.admin
    .from('referral_partners')
    .select('code')
    .eq('id', partnerId)
    .maybeSingle();
  if (partnerError || typeof partner?.code !== 'string') throw new Error('partner referral lookup failed');

  const started = new Date();
  const { error: insertError } = await args.admin.from('partner_referrals').insert({
    partner_id: partnerId,
    referred_tenant_id: args.tenantId,
    signup_intent_id: args.intentId,
    code: partner.code,
    started_at: started.toISOString(),
    window_ends_at: partnerWindowEnd(started).toISOString(),
  });
  const duplicate = insertError && (insertError as { code?: string }).code === '23505';
  if (insertError && !duplicate) throw new Error('partner referral insert failed');
}

export type PartnerReferralRow = {
  id: string;
  businessName: string;
  email: string;
  plan: string;
  startedAt: string;
  windowEndsAt: string;
  collectedPence: number | null;
  owedPence: number | null;
  paidPence: number;
  outstandingPence: number | null;
};

export type PartnerListRow = {
  id: string;
  name: string;
  code: string;
  payoutNote: string | null;
  active: boolean;
  outstandingPence: number;
  referrals: PartnerReferralRow[];
};

type ReferralQueryRow = {
  id: string;
  partner_id: string;
  referred_tenant_id: string;
  code: string;
  started_at: string;
  window_ends_at: string;
  paid_pence: number;
};

/** Subscription id on a current or older Stripe invoice. */
export function subscriptionIdOfInvoice(invoice: Stripe.Invoice): string | null {
  const modern = invoice.parent?.subscription_details?.subscription;
  const legacy = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  const ref = modern ?? legacy;
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

export function countedInvoice(invoice: Stripe.Invoice): CountedInvoice {
  const refunded = invoice.post_payment_credit_notes_amount ?? 0;
  return {
    status: invoice.status,
    created: invoice.created,
    amountPaid: invoice.amount_paid - refunded,
    subscriptionId: subscriptionIdOfInvoice(invoice),
  };
}

async function collectedForCustomer(customerId: string, window: { start: Date; end: Date }): Promise<number | null> {
  try {
    const stripe = getStripe();
    const created = {
      gte: Math.floor(window.start.getTime() / 1000),
      lt: Math.floor(window.end.getTime() / 1000),
    };
    const invoices: Stripe.Invoice[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const list = await stripe.invoices.list({
        customer: customerId,
        status: 'paid',
        limit: 100,
        created,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      invoices.push(...list.data);
      if (!list.has_more || list.data.length === 0) break;
      startingAfter = list.data[list.data.length - 1]?.id;
    }
    return collectedPence(invoices.map(countedInvoice), window);
  } catch (err) {
    console.error('[partner-referrals]', err instanceof Error ? err.name : 'Error');
    return null;
  }
}

function planLabel(rows: { plan: string | null; product: string | null }[]): string {
  const plan = rows.find((row) => row.plan === 'rounds' || row.plan === 'lite' || row.plan === 'both')?.plan;
  if (plan === 'both') return 'Rounds + Lite';
  if (plan === 'lite') return 'Lite';
  if (plan === 'rounds') return 'Rounds';
  return 'Rounds';
}

/** Everyone, with what each referred business has paid and what is still to send. Stripe failures leave the money blank. */
export async function listPartnerReferrals(): Promise<{ partners: PartnerListRow[]; error: string | null }> {
  try {
    const admin = createAdminClient();
    const { data: partners, error } = await admin
      .from('referral_partners')
      .select('id, name, code, payout_note, active')
      .order('created_at', { ascending: true });
    if (error) throw new Error('partners');
    const { data: referrals, error: referralError } = await admin
      .from('partner_referrals')
      .select('id, partner_id, referred_tenant_id, code, started_at, window_ends_at, paid_pence')
      .order('started_at', { ascending: false });
    if (referralError) throw new Error('referrals');

    const rows = (referrals ?? []) as ReferralQueryRow[];
    const tenantIds = [...new Set(rows.map((row) => row.referred_tenant_id))];
    const names = new Map<string, string>();
    const emails = new Map<string, string>();
    const plans = new Map<string, string>();
    const customers = new Map<string, string>();

    if (tenantIds.length > 0) {
      const [{ data: tenants, error: tenantError }, { data: users, error: userError }, { data: subs, error: subError }] =
        await Promise.all([
          admin.from('tenants').select('id, name').in('id', tenantIds),
          admin.from('users').select('tenant_id, email, role').in('tenant_id', tenantIds),
          admin.from('subscriptions').select('tenant_id, plan, product, source, stripe_customer_id').in('tenant_id', tenantIds),
        ]);
      if (tenantError || userError || subError) throw new Error('businesses');
      for (const tenant of tenants ?? []) {
        if (typeof tenant.id === 'string' && typeof tenant.name === 'string') names.set(tenant.id, tenant.name);
      }
      for (const user of users ?? []) {
        if (user.role === 'admin' && typeof user.tenant_id === 'string' && typeof user.email === 'string' && !emails.has(user.tenant_id)) {
          emails.set(user.tenant_id, user.email);
        }
      }
      const byTenant = new Map<string, { plan: string | null; product: string | null }[]>();
      for (const sub of subs ?? []) {
        if (typeof sub.tenant_id !== 'string') continue;
        const list = byTenant.get(sub.tenant_id) ?? [];
        list.push({ plan: typeof sub.plan === 'string' ? sub.plan : null, product: typeof sub.product === 'string' ? sub.product : null });
        byTenant.set(sub.tenant_id, list);
        if (sub.source === 'stripe' && typeof sub.stripe_customer_id === 'string' && !customers.has(sub.tenant_id)) {
          customers.set(sub.tenant_id, sub.stripe_customer_id);
        }
      }
      for (const [tenantId, list] of byTenant) plans.set(tenantId, planLabel(list));
    }

    const collected = new Map<string, number | null>();
    await Promise.all(
      rows.map(async (row) => {
        const customerId = customers.get(row.referred_tenant_id);
        if (!customerId) {
          collected.set(row.id, 0);
          return;
        }
        const amount = await collectedForCustomer(customerId, {
          start: new Date(row.started_at),
          end: new Date(row.window_ends_at),
        });
        collected.set(row.id, amount);
      }),
    );

    const byPartner = new Map<string, PartnerReferralRow[]>();
    for (const row of rows) {
      const got = collected.get(row.id) ?? null;
      const owed = got == null ? null : sharePence(got);
      const paid = typeof row.paid_pence === 'number' ? row.paid_pence : 0;
      const view: PartnerReferralRow = {
        id: row.id,
        businessName: names.get(row.referred_tenant_id) || 'Business',
        email: emails.get(row.referred_tenant_id) || '',
        plan: plans.get(row.referred_tenant_id) || 'Rounds',
        startedAt: row.started_at,
        windowEndsAt: row.window_ends_at,
        collectedPence: got,
        owedPence: owed,
        paidPence: paid,
        outstandingPence: owed == null ? null : outstandingPence(owed, paid),
      };
      const list = byPartner.get(row.partner_id) ?? [];
      list.push(view);
      byPartner.set(row.partner_id, list);
    }

    return {
      error: null,
      partners: (partners ?? []).map((partner) => {
        const list = byPartner.get(partner.id) ?? [];
        return {
          id: partner.id,
          name: partner.name,
          code: partner.code,
          payoutNote: partner.payout_note,
          active: partner.active,
          outstandingPence: list.reduce((sum, row) => sum + (row.outstandingPence ?? 0), 0),
          referrals: list,
        };
      }),
    };
  } catch (err) {
    console.error('[partner-referrals]', err instanceof Error ? err.name : 'Error');
    return { partners: [], error: 'Partner referrals could not be loaded. If this is the first time, the migration still needs pasting.' };
  }
}

/** The 10% owed right now, or null when Stripe could not be read (do not mark that as paid). */
export async function owedPenceForReferral(referralId: string): Promise<number | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('partner_referrals')
    .select('started_at, window_ends_at, referred_tenant_id')
    .eq('id', referralId)
    .maybeSingle();
  if (error || !data || typeof data.referred_tenant_id !== 'string') return null;
  const { data: subs, error: subError } = await admin
    .from('subscriptions')
    .select('source, stripe_customer_id')
    .eq('tenant_id', data.referred_tenant_id);
  if (subError) return null;
  const customerId = (subs ?? []).find((row) => row.source === 'stripe' && typeof row.stripe_customer_id === 'string')?.stripe_customer_id;
  if (typeof customerId !== 'string') return sharePence(0);
  const got = await collectedForCustomer(customerId, {
    start: new Date(data.started_at),
    end: new Date(data.window_ends_at),
  });
  if (got == null) return null;
  return sharePence(got);
}
