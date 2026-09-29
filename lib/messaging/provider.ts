import 'server-only';

import { logSend } from '@/lib/messaging/providers/log';
import {
  parsePureSmsEvent,
  pureSmsSend,
  verifyPureSmsSignature,
} from '@/lib/messaging/providers/puresms';

export type ProviderName = 'puresms' | 'log';
export type SendTextInput = {
  to: string; // E.164 UK mobile
  body: string; // already GSM-7 and fitted
  clientReference: string; // our messages.id
};
export type SendTextResult =
  | {
      ok: true;
      provider: ProviderName;
      providerMessageId: string | null;
      segments: number | null;
    }
  | {
      ok: false;
      provider: ProviderName;
      error: string;
      retryable: boolean;
    };

export type DeliveryEvent = {
  kind: 'delivery';
  eventId: string;
  providerMessageId: string;
  clientReference: string | null;
  status: 'delivered' | 'failed' | 'pending'; // mapped from deliveryStatus
  rawStatus: string;
  errorCode: string | null;
  segments: number | null;
  at: string | null;
};
export type InboundEvent = {
  kind: 'inbound';
  eventId: string;
  providerMessageId: string;
  from: string; // E.164, normalised
  to: string; // our number
  body: string;
  receivedAt: string;
};
export type WebhookEvent =
  | DeliveryEvent
  | InboundEvent
  | { kind: 'ignored'; eventId: string; reason: string };

/** 'log' unless MESSAGING_TRANSPORT === 'puresms'. */
export function activeProvider(): ProviderName {
  return process.env.MESSAGING_TRANSPORT === 'puresms' ? 'puresms' : 'log';
}

export async function sendText(input: SendTextInput): Promise<SendTextResult> {
  if (activeProvider() === 'puresms') {
    return pureSmsSend(input);
  }
  return logSend(input);
}

/** Verifies the signature and parses. Returns null when the signature is invalid or stale. */
export function parseWebhook(
  rawBody: string,
  headers: Headers,
  now?: Date,
): WebhookEvent | null {
  const secret = process.env.PURESMS_WEBHOOK_SECRET ?? '';
  const signature = headers.get('x-webhook-signature');
  const timestamp = headers.get('x-webhook-timestamp');
  const ok = verifyPureSmsSignature({
    rawBody,
    signature,
    timestamp,
    secret,
    now: now ?? new Date(),
  });
  if (!ok) return null;
  return parsePureSmsEvent(rawBody);
}

/** Our shared number, from PURESMS_SENDER. */
export function ourNumber(): string | null {
  const sender = process.env.PURESMS_SENDER;
  return sender && sender.length > 0 ? sender : null;
}
