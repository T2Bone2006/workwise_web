import { NextResponse } from 'next/server';
import { isAuthorisedCronRequest } from '@/lib/cron/auth';
import { runMorningCollectionSweep } from '@/lib/direct-debit/run-collections';
import { sweepTextWarnings } from '@/lib/messaging/low-texts';
import { sweepAutoTopUps } from '@/lib/messaging/run-auto-top-up';
import { sweepWaitingMessages } from '@/lib/messaging/release-waiting';
import { retryFailedTexts, sendHeldMessages } from '@/lib/messaging/send';
import { sendDueOwnerPushes } from '@/lib/push/owner-push';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 300;

/**
 * Morning: send texts held overnight (quiet hours 21:00–07:00 London),
 * then retry texts that failed to send, then pushes to the trader held
 * overnight (card payments, Direct Debits). Before the pushes: the Direct
 * Debit sweep (stuck collections, unprocessed GoCardless events, verification).
 * Daily cron ~07:00 UTC (8am BST / 7am GMT).
 */
export async function GET(request: Request) {
  if (!isAuthorisedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const now = new Date();
  // Messages that waited for texts: drop the expired, release the rest for businesses with texts again
  // (the new month resets the allowance, so the 1st releases the backlog). Before the held sweep so
  // released rows go out in the same run.
  // Auto top-up first (it finishes pending charges and buys packs at 07:00, never at night), so the
  // waiting sweep below can use the new texts.
  const autoTopUps = await sweepAutoTopUps(now);
  const waiting = await sweepWaitingMessages(now);
  const result = await sendHeldMessages(now);
  // Texts that failed yesterday (PureSMS down, a blip) get another go.
  const retried = await retryFailedTexts(now);

  // Direct Debit tidy-up first, so anything it pushes goes out below.
  let ddSweep: Awaited<ReturnType<typeof runMorningCollectionSweep>> | { error: string } | null = null;
  try {
    ddSweep = await runMorningCollectionSweep(createAdminClient(), now);
  } catch (err) {
    console.error('[send-held-messages] direct debit sweep', err);
    ddSweep = { error: err instanceof Error ? err.message : String(err) };
  }

  let ownerPushes = { sent: 0 };
  try {
    ownerPushes = await sendDueOwnerPushes(createAdminClient(), now);
  } catch (err) {
    console.error('[send-held-messages] owner pushes', err);
  }
  // Backstop for the 20-left / out warnings (nothing goes out at night, so this is the morning catch-up).
  const textWarnings = await sweepTextWarnings(now);
  return NextResponse.json({ ...result, autoTopUps, waiting, textWarnings, retried, ownerPushes, ddSweep });
}
