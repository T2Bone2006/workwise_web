import { NextResponse } from 'next/server';
import { completeGoCardlessConnect } from '@/lib/gocardless/oauth';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The app's own URL (NEXT_PUBLIC_APP_URL): GoCardless may call us through a tunnel while the trader is on localhost. */
function appUrl(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || new URL(request.url).origin;
}

/**
 * Public GoCardless OAuth callback (T20). No login session needed: the
 * business is found by the state's hash, so it works from the phone's browser.
 * Always a 303, never a 500.
 */
export async function GET(request: Request) {
  const base = appUrl(request);
  try {
    const params = new URL(request.url).searchParams;
    const result = await completeGoCardlessConnect(createAdminClient(), {
      state: params.get('state'),
      code: params.get('code'),
      error: params.get('error'),
    });
    const target =
      result.from === 'app'
        ? `${base}/connect/gocardless?result=${result.outcome}`
        : `${base}/settings?tab=payments&gc=${result.outcome}`;
    return NextResponse.redirect(target, 303);
  } catch (err) {
    console.error('[GET /api/gocardless/callback]', err instanceof Error ? err.name : 'error');
    return NextResponse.redirect(`${base}/settings?tab=payments&gc=error`, 303);
  }
}
