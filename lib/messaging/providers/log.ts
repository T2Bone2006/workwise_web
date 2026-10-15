import 'server-only';

import { randomUUID } from 'node:crypto';
import { countSegments } from '@/lib/messaging/gsm';
import { maskPhone } from '@/lib/messaging/phone';
import type { SendTextInput, SendTextResult } from '@/lib/messaging/provider';

/** Logs `[messaging:log] to=<masked> segments=<n> body=<first 60 chars>` and returns ok with id `log_<uuid>`. */
export async function logSend(input: SendTextInput): Promise<SendTextResult> {
  const segments = countSegments(input.body).segments;
  const preview = input.body.slice(0, 60);
  console.info(
    `[messaging:log] to=${maskPhone(input.to)} segments=${segments} body=${preview}`,
  );
  return {
    ok: true,
    provider: 'log',
    providerMessageId: `log_${randomUUID()}`,
    segments,
  };
}
