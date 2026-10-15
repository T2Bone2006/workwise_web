import { NextResponse } from 'next/server';
import { isAuthorisedCronRequest } from '@/lib/cron/auth';
import { runCashNudge } from '@/lib/team/cash-nudge';

export const maxDuration = 120;

/**
 * Daily 08:00 UTC: tell each owner about cash a team member has been holding for several days. Answers 200 with the
 * counts even if some businesses error; 500 only if the list of businesses cannot be read.
 */
export async function GET(request: Request) {
  if (!isAuthorisedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  try {
    return NextResponse.json(await runCashNudge());
  } catch (err) {
    console.error('[cron/cash-nudge]', err instanceof Error ? err.name : 'Error');
    return NextResponse.json({ error: 'Could not run' }, { status: 500 });
  }
}
