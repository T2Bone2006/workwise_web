import { NextResponse } from 'next/server';
import { reconcileWorkerDiscounts } from '@/lib/billing/worker-discount';
import { isAuthorisedCronRequest } from '@/lib/cron/auth';

export const maxDuration = 300;

/**
 * Daily 04:30 UTC: for every worker-made business with Lite, check the worker is still connected to
 * a Pro business. Not connected: the 20% comes off (and they are told). Connected again: it goes back on.
 * A business that errors is retried tomorrow; the run still answers 200 with the counts.
 */
export async function GET(request: Request) {
  if (!isAuthorisedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  try {
    return NextResponse.json(await reconcileWorkerDiscounts());
  } catch (err) {
    console.error('[cron/worker-discounts]', err instanceof Error ? err.name : 'Error');
    return NextResponse.json({ error: 'Could not run' }, { status: 500 });
  }
}
