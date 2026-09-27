import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { handleConnectEvent } from '@/lib/stripe/connect-events';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * Stripe webhook for connected accounts (card payments).
 *
 * Same shape as the platform webhook: insert the event id first, handle,
 * mark processed. A failure deletes the row and returns 500 so Stripe retries.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
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
    console.warn('[connect webhook] signature verification failed', err);
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
    console.error('[connect webhook] stripe_events insert failed', insertError);
    return NextResponse.json({ error: 'Event log unavailable' }, { status: 500 });
  }

  try {
    await handleConnectEvent(event);
    await admin
      .from('stripe_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', event.id);
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[connect webhook] ${event.type} ${event.id} failed:`, message);
    await admin.from('stripe_events').delete().eq('id', event.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
