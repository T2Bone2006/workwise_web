import { NextResponse } from 'next/server';
import { reconcileAllExtraWorkers } from '@/lib/billing/extra-workers';
import { isAuthorisedCronRequest } from '@/lib/cron/auth';

export const maxDuration = 300;

/**
 * Daily 04:45 UTC: for every Stripe-billed Pro business, make the "extra worker" line on the subscription
 * match the number of workers over the plan's allowance. Catches anything the live calls missed (a worker
 * brought back, a failed Stripe call). A business that errors is retried tomorrow; the run still answers 200
 * with the counts.
 */
export async function GET(request: Request) {
  if (!isAuthorisedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  try {
    return NextResponse.json(await reconcileAllExtraWorkers());
  } catch (err) {
    console.error('[cron/extra-workers]', err instanceof Error ? err.name : 'Error');
    return NextResponse.json({ error: 'Could not run' }, { status: 500 });
  }
}
