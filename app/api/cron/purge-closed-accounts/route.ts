import { NextResponse } from 'next/server';
import { purgeDueAccounts } from '@/lib/billing/close-account';
import { isAuthorisedCronRequest } from '@/lib/cron/auth';

export const maxDuration = 300;

/**
 * Daily 04:15 UTC: cancel anything still billing on a closed account, then
 * delete businesses whose 30-day purge date has passed (max 10 a run).
 */
export async function GET(request: Request) {
  if (!isAuthorisedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const counts = await purgeDueAccounts();
  return NextResponse.json(counts);
}
