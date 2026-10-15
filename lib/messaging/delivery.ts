import 'server-only';

import { sendEmailFallbackForMessage } from '@/lib/messaging/email-fallback';
import { activeProvider, type DeliveryEvent } from '@/lib/messaging/provider';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGE_COLUMNS = 'id, status, kind, email_fallback_at, segments';

type DeliveryOutcome =
  | 'updated'
  | 'already_final'
  | 'not_found'
  | 'fallback_sent'
  | 'fallback_skipped';

type MessageRow = {
  id: string;
  status: string;
  kind: string;
  email_fallback_at: string | null;
  segments: number | null;
};

function isUuid(value: string | null): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Raw status, plus the provider's segment count when it disagrees with what we billed. */
function providerStatusDetail(
  event: DeliveryEvent,
  rowSegments: number | null,
): string {
  if (typeof event.segments === 'number' && event.segments !== rowSegments) {
    console.info(
      '[messaging delivery] segments differ',
      event.eventId,
      `provider=${event.segments} row=${rowSegments ?? 'null'}`,
    );
    return `${event.rawStatus}; segments=${event.segments}`;
  }
  return event.rawStatus;
}

function failureMessage(event: DeliveryEvent): string {
  if (event.errorCode) {
    return `Not delivered: ${event.rawStatus}, code ${event.errorCode}`;
  }
  return `Not delivered: ${event.rawStatus}`;
}

export async function handleDeliveryEvent(
  event: DeliveryEvent,
): Promise<{ outcome: DeliveryOutcome }> {
  const admin = createAdminClient();

  let row: MessageRow | null = null;

  // ClientReference is our messages.id. Prefer it: the provider id is a
  // digit string that may not match the value stored at send time.
  if (isUuid(event.clientReference)) {
    const { data: byId, error: byIdError } = await admin
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('id', event.clientReference)
      .maybeSingle();

    if (byIdError) {
      throw new Error(byIdError.message);
    }
    row = byId as MessageRow | null;
  }

  if (!row) {
    const { data: byProvider, error: byProviderError } = await admin
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('provider', activeProvider())
      .eq('provider_message_id', event.providerMessageId)
      .maybeSingle();

    if (byProviderError) {
      throw new Error(byProviderError.message);
    }
    row = byProvider as MessageRow | null;
  }

  if (!row) {
    console.info('[messaging delivery] not_found', event.eventId);
    return { outcome: 'not_found' };
  }

  if (row.status === 'delivered' || row.status === 'failed') {
    return { outcome: 'already_final' };
  }

  const provider_status = providerStatusDetail(event, row.segments);

  if (event.status === 'pending') {
    const { error } = await admin
      .from('messages')
      .update({ provider_status })
      .eq('id', row.id);
    if (error) throw new Error(error.message);
    return { outcome: 'updated' };
  }

  if (event.status === 'delivered') {
    const { error } = await admin
      .from('messages')
      .update({
        status: 'delivered',
        delivered_at: event.at ?? new Date().toISOString(),
        provider_status,
      })
      .eq('id', row.id);
    if (error) throw new Error(error.message);
    return { outcome: 'updated' };
  }

  const { error } = await admin
    .from('messages')
    .update({
      status: 'failed',
      provider_status,
      error: failureMessage(event),
    })
    .eq('id', row.id);
  if (error) throw new Error(error.message);

  if (row.kind === 'reminder' || row.email_fallback_at) {
    return { outcome: 'fallback_skipped' };
  }

  const fallback = await sendEmailFallbackForMessage(admin, row.id);
  return { outcome: fallback.sent ? 'fallback_sent' : 'fallback_skipped' };
}
