import { NextResponse } from 'next/server';
import { isAuthorisedCronRequest } from '@/lib/cron/auth';
import { retryFailedTexts, sendHeldMessages } from '@/lib/messaging/send';

export const maxDuration = 300;

/**
 * Morning: send texts held overnight (quiet hours 21:00–07:00 London),
 * then retry texts that failed to send.
 * Daily cron ~07:00 UTC (8am BST / 7am GMT).
 */
export async function GET(request: Request) {
  if (!isAuthorisedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const now = new Date();
  const result = await sendHeldMessages(now);
  // Texts that failed yesterday (PureSMS down, a blip) get another go.
  const retried = await retryFailedTexts(now);
  return NextResponse.json({ ...result, retried });
}
