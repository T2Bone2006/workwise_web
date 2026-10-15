import { NextResponse } from 'next/server';
import { isAuthorisedCronRequest } from '@/lib/cron/auth';
import { runEveningCollections } from '@/lib/direct-debit/run-collections';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Evening: collect what Direct Debit customers owe (Rounds businesses with
 * Direct Debit on). Daily cron 17:00 UTC (6pm BST / 5pm GMT).
 */
export async function GET(request: Request) {
  if (!isAuthorisedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  try {
    return NextResponse.json(await runEveningCollections(createAdminClient()));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[dd evening]', error);
    return NextResponse.json({ error }, { status: 500 });
  }
}
