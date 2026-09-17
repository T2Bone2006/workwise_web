'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getStripe, getAppUrl } from '@/lib/stripe/client';

/**
 * Opens Stripe's hosted Billing Portal for the current tenant. All billing
 * management (card, cancel, switch plan, invoices) lives there; WorkWise has
 * no custom billing UI.
 */
export async function openBillingPortal(): Promise<{ success: false; error: string } | never> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) {
    return { success: false, error: 'No tenant found for this login.' };
  }

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('stripe_customer_id')
    .eq('id', tenantId)
    .maybeSingle();

  if (!tenant?.stripe_customer_id) {
    return { success: false, error: 'This account is managed by WorkWise. Contact us to change your plan.' };
  }

  let url: string;
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: `${getAppUrl()}/settings`,
    });
    url = session.url;
  } catch (err) {
    console.error('[openBillingPortal]', err);
    return { success: false, error: 'Could not open the billing portal. Please try again.' };
  }

  redirect(url);
}
