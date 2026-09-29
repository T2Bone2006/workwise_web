import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  SendTextInput,
  SendTextResult,
  WebhookEvent,
} from '@/lib/messaging/provider';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';

const SEND_URL = 'https://connect-api.divergent.cloud/sms/send';
const TIMEOUT_MS = 10_000;
const MAX_SKEW_MS = 5 * 60 * 1000;

const FAILED_STATUSES = new Set([
  'Failed',
  'Expired',
  'Rejected',
  'Cancelled',
  'Deleted',
]);

function fieldErrors(errors: unknown): string | null {
  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) return null;
  const parts: string[] = [];
  for (const [field, value] of Object.entries(errors as Record<string, unknown>)) {
    const messages = Array.isArray(value) ? value : [value];
    const unique = [...new Set(messages.filter((m): m is string => typeof m === 'string'))];
    if (unique.length > 0) parts.push(`${field}: ${unique.join('; ')}`);
  }
  return parts.length > 0 ? parts.join(' | ') : null;
}

export async function pureSmsSend(
  input: SendTextInput,
): Promise<SendTextResult> {
  const apiKey = process.env.PURESMS_API_KEY;
  const sender = process.env.PURESMS_SENDER;
  if (!apiKey || !sender) {
    return {
      ok: false,
      provider: 'puresms',
      error: 'PureSMS is not configured',
      retryable: false,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(SEND_URL, {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        recipient: input.to,
        content: input.body,
        clientReference: input.clientReference,
      }),
      signal: controller.signal,
    });

    if (response.ok) {
      let providerMessageId: string | null = null;
      try {
        const payload = (await response.json()) as { id?: unknown };
        if (typeof payload.id === 'string') {
          providerMessageId = payload.id;
        } else if (payload.id != null) {
          // Keep as string; digit ids are too big for JS number.
          providerMessageId = String(payload.id);
        }
      } catch {
        // 2xx with unreadable body still counts as sent.
      }
      return {
        ok: true,
        provider: 'puresms',
        providerMessageId,
        segments: null,
      };
    }

    const status = response.status;
    let detail = response.statusText || 'request failed';
    try {
      const payload = (await response.json()) as {
        message?: unknown;
        error?: unknown;
        errors?: unknown;
      };
      if (typeof payload.message === 'string' && payload.message) {
        detail = payload.message;
      } else if (typeof payload.error === 'string' && payload.error) {
        detail = payload.error;
      }
      // A 400 says "One or more errors occurred!" and puts the reason in
      // errors: { field: [messages] }. Keep it, or the row never says why.
      const reasons = fieldErrors(payload.errors);
      if (reasons) detail = `${detail} ${reasons}`;
    } catch {
      // keep statusText
    }

    return {
      ok: false,
      provider: 'puresms',
      error: `PureSMS ${status}: ${detail}`,
      retryable: status >= 500,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const message = err instanceof Error ? err.message : String(err);
    const aborted =
      name === 'AbortError' ||
      (typeof message === 'string' && /aborted/i.test(message));
    return {
      ok: false,
      provider: 'puresms',
      error: aborted ? 'PureSMS timeout' : `PureSMS network error: ${message}`,
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function verifyPureSmsSignature(p: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  now: Date;
}): boolean {
  const { rawBody, signature, timestamp, secret, now } = p;
  if (!secret || !signature || !timestamp) return false;

  const tsSeconds = Number(timestamp);
  if (!Number.isFinite(tsSeconds)) return false;
  if (Math.abs(now.getTime() - tsSeconds * 1000) > MAX_SKEW_MS) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('base64');

  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Digit ids are bigger than Number.MAX_SAFE_INTEGER, so read them from the raw text. */
function messageIdFromRaw(rawBody: string): string {
  const match = /"(?:MessageId|messageId)"\s*:\s*"?(\d+)"?/.exec(rawBody);
  return match?.[1] ?? '';
}

function pick(data: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (data[key] !== undefined) return data[key];
  }
  return undefined;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function asNullableText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return String(value);
}

export function parsePureSmsEvent(rawBody: string): WebhookEvent {
  let envelope: {
    id?: unknown;
    eventType?: unknown;
    event_type?: unknown;
    data?: Record<string, unknown> | null;
  };
  try {
    envelope = JSON.parse(rawBody) as typeof envelope;
  } catch {
    return { kind: 'ignored', eventId: 'unknown', reason: 'invalid_json' };
  }

  const eventId =
    typeof envelope.id === 'string' && envelope.id
      ? envelope.id
      : envelope.id != null
        ? String(envelope.id)
        : 'unknown';

  const eventType = envelope.event_type ?? envelope.eventType;
  const data =
    envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
      ? envelope.data
      : null;

  if (eventType === 1 || eventType === '1') {
    if (!data) {
      return { kind: 'ignored', eventId, reason: 'missing_data' };
    }
    // Text status only. The numeric DeliveryStatus is a different code and is ignored.
    const statusText = pick(data, 'DeliveryStatusStr', 'deliveryStatus');
    const rawStatus = typeof statusText === 'string' ? statusText : '';
    let status: 'delivered' | 'failed' | 'pending' = 'pending';
    if (rawStatus === 'Delivered') status = 'delivered';
    else if (FAILED_STATUSES.has(rawStatus)) status = 'failed';

    const clientReference = asNullableText(
      pick(data, 'ClientReference', 'clientReference'),
    );
    const errorCode = asNullableText(pick(data, 'ErrorCode', 'errorCode'));
    const parts = pick(data, 'SmsParts', 'smsParts');
    const segments =
      typeof parts === 'number' && Number.isFinite(parts) ? parts : null;
    const deliveredAt = pick(data, 'DeliveredAt', 'deliveredAt');
    const processedAt = pick(data, 'ProcessedAt', 'processedAt');
    const at =
      typeof deliveredAt === 'string'
        ? deliveredAt
        : typeof processedAt === 'string'
          ? processedAt
          : null;

    return {
      kind: 'delivery',
      eventId,
      providerMessageId: messageIdFromRaw(rawBody),
      clientReference,
      status,
      rawStatus,
      errorCode,
      segments,
      at,
    };
  }

  if (eventType === 2 || eventType === '2') {
    if (!data) {
      return { kind: 'ignored', eventId, reason: 'missing_data' };
    }
    const senderRaw = asText(pick(data, 'Sender', 'sender'));
    const normalised = normalizeUkPhoneE164(senderRaw);
    const from =
      normalised ??
      (senderRaw.startsWith('+') ? senderRaw : senderRaw ? `+${senderRaw}` : '');

    return {
      kind: 'inbound',
      eventId,
      providerMessageId: messageIdFromRaw(rawBody),
      from,
      to: asText(pick(data, 'InboundNumber', 'inboundNumber')),
      body: asText(pick(data, 'Body', 'body')),
      receivedAt: asText(pick(data, 'ReceivedAt', 'receivedAt')),
    };
  }

  return {
    kind: 'ignored',
    eventId,
    reason: `unsupported_eventType_${String(eventType)}`,
  };
}
