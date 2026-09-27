'use server';

import { createClient } from '@/lib/supabase/server';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getPaymentSettings } from '@/lib/data/payments/settings';
import type { ConnectStatus } from '@/lib/payments/connect-status';
import {
  ConnectMismatchError,
  connectSignupDetails,
  createExpressLoginLink,
  createOnboardingLink,
  ensureConnectedAccount,
  isTenantAdmin,
  retrieveVerifiedAccount,
  syncConnectMirror,
} from '@/lib/stripe/connect';

const OWNER_ONLY = 'Only the account owner can set up card payments.';
const MISCONFIGURED =
  'Card payments are misconfigured for this business — contact WorkWise support.';
const NOT_READY = 'Card payments are not set up yet';

async function requireConnectOwner(): Promise<
  | { ok: true; tenantId: string; email: string | null }
  | { ok: false; error: string }
> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { ok: false, error: 'Not signed in' };

  const products = await getTenantProducts();
  if (!products.hasRounds) {
    return { ok: false, error: 'Payments are part of Rounds.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false, error: 'Not signed in' };
  if (!(await isTenantAdmin(supabase, user.id))) {
    return { ok: false, error: OWNER_ONLY };
  }

  const { data: row } = await supabase
    .from('users')
    .select('email')
    .eq('id', user.id)
    .maybeSingle();
  const email =
    typeof row?.email === 'string' && row.email.trim() !== ''
      ? row.email
      : (user.email ?? null);

  return { ok: true, tenantId, email };
}

export async function startCardPaymentsSetup(): Promise<
  { success: true; url: string } | { success: false; error: string }
> {
  const owner = await requireConnectOwner();
  if (!owner.ok) return { success: false, error: owner.error };

  try {
    const identity = await connectSignupDetails(owner.tenantId, owner.email);
    const { accountId } = await ensureConnectedAccount({
      tenantId: owner.tenantId,
      email: identity.email,
      businessName: identity.businessName,
    });
    const url = await createOnboardingLink({
      tenantId: owner.tenantId,
      accountId,
      from: 'web',
    });
    return { success: true, url };
  } catch (err) {
    if (err instanceof ConnectMismatchError) {
      return { success: false, error: MISCONFIGURED };
    }
    console.error('[startCardPaymentsSetup]', err);
    return { success: false, error: 'Could not start card payments setup. Please try again.' };
  }
}

export async function openStripeDashboard(): Promise<
  { success: true; url: string } | { success: false; error: string }
> {
  const owner = await requireConnectOwner();
  if (!owner.ok) return { success: false, error: owner.error };

  const supabase = await createClient();
  const settings = await getPaymentSettings(supabase, owner.tenantId);
  if (!settings.connect.accountId || settings.connect.status !== 'active') {
    return { success: false, error: NOT_READY };
  }

  try {
    const url = await createExpressLoginLink({
      tenantId: owner.tenantId,
      accountId: settings.connect.accountId,
    });
    return { success: true, url };
  } catch (err) {
    if (err instanceof ConnectMismatchError) {
      return { success: false, error: MISCONFIGURED };
    }
    console.error('[openStripeDashboard]', err);
    return { success: false, error: 'Could not open Stripe. Please try again.' };
  }
}

export async function refreshConnectStatus(): Promise<
  { success: true; status: ConnectStatus } | { success: false; error: string }
> {
  const owner = await requireConnectOwner();
  if (!owner.ok) return { success: false, error: owner.error };

  const supabase = await createClient();
  const settings = await getPaymentSettings(supabase, owner.tenantId);
  if (!settings.connect.accountId) {
    return { success: true, status: 'none' };
  }

  try {
    const account = await retrieveVerifiedAccount(
      owner.tenantId,
      settings.connect.accountId,
    );
    const status = await syncConnectMirror({ tenantId: owner.tenantId, account });
    return { success: true, status };
  } catch (err) {
    if (err instanceof ConnectMismatchError) {
      return { success: false, error: MISCONFIGURED };
    }
    console.error('[refreshConnectStatus]', err);
    return { success: false, error: 'Could not refresh card payments status. Please try again.' };
  }
}
