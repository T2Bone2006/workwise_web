import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { ensurePaymentSettingsRow } from '@/lib/payments/money-core';
import {
  connectStatus,
  mirrorFromStripeAccount,
  type ConnectStatus,
} from '@/lib/payments/connect-status';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppUrl, getStripe } from '@/lib/stripe/client';
import {
  CONNECT_API_VERSION,
  buildConnectAccountParams,
} from '@/lib/stripe/connect-params';

export class ConnectMismatchError extends Error {
  constructor() {
    super('Connect account does not belong to this business');
    this.name = 'ConnectMismatchError';
  }
}

export type PayoutSummary = {
  available: number;
  pending: number;
  nextPayout: { amount: number; arrivalDate: string } | null;
  recent: { amount: number; arrivalDate: string; status: string }[];
};

type TenantConnectRow = {
  name?: string | null;
  settings?: unknown;
  stripe_connect_account_id?: string | null;
};

function connectCreateClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('Missing STRIPE_SECRET_KEY');
  return new Stripe(secretKey, {
    apiVersion: CONNECT_API_VERSION as Stripe.LatestApiVersion,
    appInfo: { name: 'WorkWise', url: 'https://joinworkwise.com' },
  });
}

function companyEmail(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object') return null;
  const company = (settings as { company?: { email?: unknown } }).company;
  if (!company || typeof company.email !== 'string') return null;
  const email = company.email.trim();
  return email === '' ? null : email;
}

export async function isTenantAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  return data?.role === 'admin';
}

export async function connectSignupDetails(
  tenantId: string,
  loginEmail: string | null,
): Promise<{ email: string | null; businessName: string }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('tenants')
    .select('name, settings')
    .eq('id', tenantId)
    .maybeSingle();
  const row = data as { name?: string | null; settings?: unknown } | null;
  const name = row?.name?.trim();
  return {
    email: companyEmail(row?.settings) ?? loginEmail,
    businessName: name && name !== '' ? name : 'WorkWise',
  };
}

/** Returns the tenant's account id, creating the Express account if there is none. Idempotent (Stripe idempotency key + DB re-read). */
export async function ensureConnectedAccount(p: {
  tenantId: string;
  email: string | null;
  businessName: string;
}): Promise<{ accountId: string; created: boolean }> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('tenants')
    .select('stripe_connect_account_id')
    .eq('id', p.tenantId)
    .maybeSingle();
  const stored = (existing as TenantConnectRow | null)?.stripe_connect_account_id;
  if (typeof stored === 'string' && stored !== '') {
    return { accountId: stored, created: false };
  }

  const account = await connectCreateClient().accounts.create(
    buildConnectAccountParams(p),
    { idempotencyKey: `ww-connect-acct-${p.tenantId}` },
  );

  const { data: updated, error } = await admin
    .from('tenants')
    .update({ stripe_connect_account_id: account.id })
    .eq('id', p.tenantId)
    .is('stripe_connect_account_id', null)
    .select('id');

  if (error) throw error;

  if (!updated || updated.length === 0) {
    const { data: again } = await admin
      .from('tenants')
      .select('stripe_connect_account_id')
      .eq('id', p.tenantId)
      .maybeSingle();
    const winner = (again as TenantConnectRow | null)?.stripe_connect_account_id;
    if (typeof winner === 'string' && winner !== '') {
      return { accountId: winner, created: false };
    }
    throw new Error('Could not save the Stripe account.');
  }

  await ensurePaymentSettingsRow(admin, p.tenantId);
  await syncConnectMirror({ tenantId: p.tenantId, account });
  return { accountId: account.id, created: true };
}

/** Retrieves the account with the platform client and checks metadata.workwise_tenant_id === tenantId. */
export async function retrieveVerifiedAccount(
  tenantId: string,
  accountId: string,
): Promise<Stripe.Account> {
  const account = await getStripe().accounts.retrieve(accountId);
  const metadataTenantId = account.metadata?.workwise_tenant_id;
  if (metadataTenantId !== tenantId) {
    console.error('[retrieveVerifiedAccount] tenant mismatch', {
      tenantId,
      accountId,
      metadataTenantId,
    });
    throw new ConnectMismatchError();
  }
  return account;
}

export async function createOnboardingLink(p: {
  tenantId: string;
  accountId: string;
  from: 'web' | 'app';
}): Promise<string> {
  const app = getAppUrl();
  const link = await getStripe().accountLinks.create({
    account: p.accountId,
    type: 'account_onboarding',
    collection_options: { fields: 'eventually_due' },
    return_url: `${app}/connect/return?from=${p.from}`,
    refresh_url: `${app}/connect/refresh?from=${p.from}`,
  });
  return link.url;
}

export async function createExpressLoginLink(p: {
  tenantId: string;
  accountId: string;
}): Promise<string> {
  await retrieveVerifiedAccount(p.tenantId, p.accountId);
  const link = await getStripe().accounts.createLoginLink(p.accountId);
  return link.url;
}

/** Writes the mirror columns with the admin client; sets tenants.stripe_connect_onboarded_at the first time status becomes active. */
export async function syncConnectMirror(p: {
  tenantId: string;
  account: Stripe.Account;
}): Promise<ConnectStatus> {
  const mirror = mirrorFromStripeAccount(p.account);
  const status = connectStatus(true, mirror);
  const admin = createAdminClient();
  const { error } = await admin.from('tenant_payment_settings').upsert(
    {
      tenant_id: p.tenantId,
      ...mirror,
      stripe_connect_synced_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' },
  );
  if (error) throw error;

  if (status === 'active') {
    await admin
      .from('tenants')
      .update({ stripe_connect_onboarded_at: new Date().toISOString() })
      .eq('id', p.tenantId)
      .is('stripe_connect_onboarded_at', null);
  }

  return status;
}

function gbpMinor(rows: { amount: number; currency: string }[] | null | undefined): number {
  if (!rows) return 0;
  return rows
    .filter((row) => row.currency === 'gbp')
    .reduce((sum, row) => sum + row.amount, 0);
}

function arrivalDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export async function getPayoutSummary(p: {
  tenantId: string;
  accountId: string;
}): Promise<PayoutSummary> {
  await retrieveVerifiedAccount(p.tenantId, p.accountId);
  const stripe = getStripe();
  const opts = { stripeAccount: p.accountId, timeout: 3000 };
  const [balance, payouts] = await Promise.all([
    stripe.balance.retrieve({}, opts),
    stripe.payouts.list({ limit: 4 }, opts),
  ]);

  const upcoming = payouts.data
    .filter((row) => row.status === 'pending' || row.status === 'in_transit')
    .filter((row) => row.currency === 'gbp')
    .sort((a, b) => a.arrival_date - b.arrival_date);

  const next = upcoming[0];
  return {
    available: gbpMinor(balance.available),
    pending: gbpMinor(balance.pending),
    nextPayout: next
      ? { amount: next.amount, arrivalDate: arrivalDate(next.arrival_date) }
      : null,
    recent: payouts.data
      .filter((row) => row.currency === 'gbp')
      .map((row) => ({
        amount: row.amount,
        arrivalDate: arrivalDate(row.arrival_date),
        status: row.status,
      })),
  };
}

/** Looks up the tenant that owns a connected account id (admin client). */
/** Null only when no business has this account. Throws on a database error, so a webhook retries instead of ignoring the event. */
export async function tenantIdForAccount(accountId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('tenants')
    .select('id')
    .eq('stripe_connect_account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  const id = (data as { id?: string } | null)?.id;
  return typeof id === 'string' ? id : null;
}
