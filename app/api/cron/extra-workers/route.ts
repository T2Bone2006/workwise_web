import { NextResponse } from 'next/server';
import { reconcileAllExtraWorkers } from '@/lib/billing/extra-workers';
import { reconcileAllRoundsTeams } from '@/lib/billing/rounds-team';
import { isAuthorisedCronRequest } from '@/lib/cron/auth';

export const maxDuration = 300;

/**
 * Daily 04:45 UTC: for every Stripe-billed Pro business, make the "extra worker" line on the subscription
 * match the number of workers over the plan's allowance; and for every Stripe-billed Rounds business, make the
 * "Rounds team member" line match the number of leads. Catches anything the live calls missed (a worker
 * brought back, a failed Stripe call). A business that errors is retried tomorrow; the run still answers 200
 * with the counts.
 */
export async function GET(request: Request) {
  if (!isAuthorisedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  try {
    const pro = await reconcileAllExtraWorkers();
    // A failure in the Rounds pass must not hide the Pro tally (and the other way round it already can't).
    let rounds: Awaited<ReturnType<typeof reconcileAllRoundsTeams>> | { error: string };
    try {
      rounds = await reconcileAllRoundsTeams();
    } catch (err) {
      console.error('[cron/extra-workers] rounds', err instanceof Error ? err.name : 'Error');
      rounds = { error: 'Could not run' };
    }
    // The Pro keys stay at the top level so anything reading them keeps working.
    return NextResponse.json({ ...pro, pro, rounds });
  } catch (err) {
    console.error('[cron/extra-workers]', err instanceof Error ? err.name : 'Error');
    return NextResponse.json({ error: 'Could not run' }, { status: 500 });
  }
}
