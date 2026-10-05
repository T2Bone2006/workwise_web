import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { textPackByKey, type TextPackKey } from '@/lib/messaging/credits';
import { getAppUrl, getStripe } from '@/lib/stripe/client';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Creates (or reuses) the tenant's Stripe customer and a Checkout Session for one pack. */
export async function createTextPackCheckout(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    userEmail: string | null;
    packKey: TextPackKey;
    returnTo: 'dashboard' | 'phone' | 'lite';
  },
): Promise<{ url: string } | { error: string }> {
  const pack = textPackByKey(p.packKey);
  if (!pack) return { error: 'Unknown pack' };

  const priceId = process.env[pack.priceEnv];
  if (!priceId) return { error: 'Text packs are not set up yet' };

  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('name, stripe_customer_id')
    .eq('id', p.tenantId)
    .maybeSingle();

  if (tenantError || !tenant) return { error: 'Account not found' };

  let customerId = typeof tenant.stripe_customer_id === 'string' ? tenant.stripe_customer_id : null;
  if (!customerId) {
    const customer = await getStripe().customers.create({
      email: p.userEmail ?? undefined,
      name: typeof tenant.name === 'string' ? tenant.name : undefined,
      metadata: { workwise_tenant_id: p.tenantId },
    });
    const createdId = customer.id;
    const { data: saved, error: saveError } = await admin
      .from('tenants')
      .update({ stripe_customer_id: createdId })
      .eq('id', p.tenantId)
      .is('stripe_customer_id', null)
      .select('stripe_customer_id');
    if (saveError) return { error: 'Could not save the billing customer' };

    if (saved && saved.length > 0) {
      customerId = createdId;
    } else {
      const { data: again, error: rereadError } = await admin
        .from('tenants')
        .select('stripe_customer_id')
        .eq('id', p.tenantId)
        .maybeSingle();
      const savedId = typeof again?.stripe_customer_id === 'string' ? again.stripe_customer_id : null;
      if (rereadError || !savedId) return { error: 'Could not save the billing customer' };
      customerId = savedId;
    }
  }

  const appUrl = getAppUrl();
  const successUrl =
    p.returnTo === 'phone'
      ? `${appUrl}/connect/texts?status=done`
      : `${appUrl}/messages/texts-bought?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl =
    p.returnTo === 'phone'
      ? `${appUrl}/connect/texts?status=cancelled`
      : p.returnTo === 'lite'
        ? `${appUrl}/lite/widget#texts`
        : `${appUrl}/messages`;

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { kind: 'text_pack', tenant_id: p.tenantId, pack_key: pack.key },
    payment_intent_data: {
      metadata: { kind: 'text_pack', tenant_id: p.tenantId, pack_key: pack.key },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  if (!session.url) return { error: 'Could not start checkout' };
  return { url: session.url };
}

/**
 * Webhook branch. Returns true when texts were added now.
 * Throws only on database errors (so Stripe retries).
 */
export async function creditTextPackFromSession(
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  if (session.payment_status !== 'paid') return false;

  const pack = textPackByKey(session.metadata?.pack_key ?? '');
  const tenantId = session.metadata?.tenant_id ?? '';
  if (!pack || !UUID_RE.test(tenantId)) {
    console.warn('[creditTextPackFromSession] refused: pack or tenant id', {
      pack_key: session.metadata?.pack_key ?? null,
    });
    return false;
  }

  const customerId = stripeRefId(session.customer);
  const admin = createAdminClient();
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('id, stripe_customer_id')
    .eq('id', tenantId)
    .maybeSingle();

  if (tenantError) throw new Error(tenantError.message);

  if (!tenant || tenant.stripe_customer_id !== customerId) {
    const tagged = tenant ? await stripeCustomerMatchesTenant(customerId, tenantId) : false;
    if (!tagged) {
      console.error('[creditTextPackFromSession] refused', {
        tenant_id: tenantId,
        session_id: session.id,
      });
      return false;
    }
  }

  const { data, error } = await admin.rpc('add_text_pack', {
    p_tenant_id: tenantId,
    p_pack_key: pack.key,
    p_texts: pack.texts,
    p_amount_pence: session.amount_total ?? pack.pricePence,
    p_checkout_session_id: session.id,
    p_payment_intent_id: stripeRefId(session.payment_intent),
  });

  if (error) throw new Error(error.message);
  return data === true;
}

async function stripeCustomerMatchesTenant(
  customerId: string | null,
  tenantId: string,
): Promise<boolean> {
  if (!customerId) return false;
  const customer = await getStripe().customers.retrieve(customerId);
  if (customer.deleted) return false;
  return customer.metadata?.workwise_tenant_id === tenantId;
}

function stripeRefId(ref: string | { id: string } | null): string | null {
  if (typeof ref === 'string') return ref;
  if (ref && typeof ref.id === 'string') return ref.id;
  return null;
}
