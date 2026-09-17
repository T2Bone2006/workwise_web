import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { provisionFromCheckoutSession } from '@/lib/stripe/provision';
import { syncSubscription } from '@/lib/stripe/sync-subscription';

export const runtime = 'nodejs';

/**
 * Stripe webhook for the platform account (subscriptions).
 *
 * Idempotency: the event id is inserted into stripe_events before any work; a
 * redelivery hits the primary key and is acknowledged immediately. Any
 * failure after that returns 500 so Stripe retries — every handler is safe to
 * re-run.
 *
 * Events to enable on the endpoint:
 *   checkout.session.completed
 *   customer.subscription.created / updated / deleted
 *   invoice.payment_failed
 *   customer.subscription.trial_will_end
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    console.warn('[stripe webhook] signature verification failed', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error: insertError } = await admin
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error('[stripe webhook] stripe_events insert failed', insertError);
    return NextResponse.json({ error: 'Event log unavailable' }, { status: 500 });
  }

  try {
    await handleEvent(event);
    await admin.from('stripe_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id);
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe webhook] ${event.type} ${event.id} failed:`, message);
    // Clear the row so the retry isn't treated as a duplicate.
    await admin.from('stripe_events').delete().eq('id', event.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode === 'subscription') {
        await provisionFromCheckoutSession(session);
      }
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      await syncSubscription(event.data.object);
      return;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const subscriptionId = invoiceSubscriptionId(invoice);
      if (subscriptionId) {
        const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
        await syncSubscription(subscription);
      }
      // Dunning email: handled by Stripe's own reminders for now (Billing settings).
      return;
    }
    case 'customer.subscription.trial_will_end': {
      await syncSubscription(event.data.object);
      // Trial-ending email is a Phase 7 launch-checklist item.
      return;
    }
    default:
      return;
  }
}

/** Newer API versions nest the subscription under invoice.parent; older ones expose invoice.subscription. */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const modern = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } } };
  }).parent?.subscription_details?.subscription;
  const legacy = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  const ref = modern ?? legacy;
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}
