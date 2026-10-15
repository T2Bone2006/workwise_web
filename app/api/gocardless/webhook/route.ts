import { after, NextResponse } from 'next/server';
import { processGoCardlessEvents, storeGoCardlessEvents, type GcEvent } from '@/lib/direct-debit/webhook';
import { goCardlessConfig, isGoCardlessConfigured } from '@/lib/gocardless/config';
import { isValidGoCardlessSignature } from '@/lib/gocardless/signature';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GoCardless webhook (every connected business). Verify → store every event →
 * reply 200 quickly → process the stored events after the reply.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!isGoCardlessConfigured()) {
    return NextResponse.json({ error: 'Not configured' }, { status: 500 });
  }

  const signature = request.headers.get('webhook-signature');
  if (!isValidGoCardlessSignature(rawBody, signature, goCardlessConfig().webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 498 });
  }

  let events: GcEvent[];
  try {
    const parsed = JSON.parse(rawBody) as { events?: unknown };
    if (!parsed || !Array.isArray(parsed.events)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    events = parsed.events as GcEvent[];
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const admin = createAdminClient();
  let ids: string[];
  try {
    ids = await storeGoCardlessEvents(admin, events);
  } catch (err) {
    console.error('[gocardless webhook] could not store events', err instanceof Error ? err.message : 'error');
    return NextResponse.json({ error: 'Event log unavailable' }, { status: 500 });
  }

  after(async () => {
    await processGoCardlessEvents(admin, { ids });
  });
  return NextResponse.json({ received: events.length });
}
