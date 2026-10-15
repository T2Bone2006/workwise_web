import { NextResponse } from 'next/server';
import { isAuthorisedCronRequest } from '@/lib/cron/auth';
import { endIdleConversations } from '@/lib/lite/end-conversations';
import { failStuckLeadTexts, sendDueLeadTexts } from '@/lib/lite/texts';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 60;

function errorName(err: unknown): string {
  return err instanceof Error && err.name ? err.name : 'Error';
}

const NO_TEXTS = { claimed: 0, sent: 0, emailed: 0, skipped: 0, failed: 0 };
const NO_CHATS = { ended: 0, summarised: 0 };

/**
 * Every minute: give up on texts stuck in sending, send the ones that are due,
 * then close chats that have been quiet for 20 minutes. Not in vercel.json —
 * Phase 7 decides how this runs in production. On the laptop: npm run lite:tick.
 */
export async function GET(request: Request) {
  if (!isAuthorisedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const now = new Date();
  const errors: string[] = [];
  let stuck = 0;
  let texts = NO_TEXTS;
  let conversations = NO_CHATS;

  try {
    const admin = createAdminClient();

    try {
      stuck = await failStuckLeadTexts(admin, now);
    } catch (err) {
      errors.push(errorName(err));
      console.error('[lite-tick] stuck', errorName(err));
    }

    try {
      texts = await sendDueLeadTexts(admin, now, 50);
    } catch (err) {
      errors.push(errorName(err));
      console.error('[lite-tick] texts', errorName(err));
    }

    try {
      conversations = await endIdleConversations(admin, now, 20);
    } catch (err) {
      errors.push(errorName(err));
      console.error('[lite-tick] conversations', errorName(err));
    }
  } catch (err) {
    errors.push(errorName(err));
    console.error('[lite-tick]', errorName(err));
  }

  return NextResponse.json({ stuck, texts, conversations, errors });
}
