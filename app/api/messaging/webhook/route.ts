import { NextResponse } from 'next/server';
import { handleDeliveryEvent } from '@/lib/messaging/delivery';
import { handleInboundText } from '@/lib/messaging/inbound';
import { parseWebhook } from '@/lib/messaging/provider';

export const runtime = 'nodejs';

/**
 * PureSMS delivery reports and inbound texts.
 * Signature is checked on the raw body before any JSON is trusted.
 * 200 for every event we understood (including unknown messages) so PureSMS
 * does not disable the endpoint. 500 only when our side throws (retry).
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const event = parseWebhook(rawBody, request.headers);
  if (!event) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    if (event.kind === 'ignored') {
      return NextResponse.json({ received: true, ignored: true });
    }
    if (event.kind === 'delivery') {
      await handleDeliveryEvent(event);
      return NextResponse.json({ received: true });
    }
    await handleInboundText(event);
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[messaging webhook] ${event.kind} ${event.eventId} ${message}`,
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export function GET(): Response {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
