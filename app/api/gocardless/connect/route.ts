import { NextResponse } from 'next/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { isGoCardlessConfigured } from '@/lib/gocardless/config';
import { goCardlessPrefillFor } from '@/lib/gocardless/connect-prefill';
import { startGoCardlessConnect } from '@/lib/gocardless/oauth';
import { isTenantAdmin } from '@/lib/stripe/connect';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function settingsRedirect(request: Request, gc: string): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || new URL(request.url).origin;
  return NextResponse.redirect(`${base}/settings?tab=payments&gc=${gc}`, 303);
}

/** Dashboard form POST: Settings → Payments → Connect GoCardless (T20). */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const tenantId = user ? await getTenantIdForCurrentUser() : null;
    if (!user || !tenantId) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    const products = await getTenantProducts();
    if (!products.hasRounds || !(await isTenantAdmin(supabase, user.id))) {
      return settingsRedirect(request, 'not_allowed');
    }
    if (!isGoCardlessConfigured()) {
      return settingsRedirect(request, 'not_configured');
    }

    const form = await request.formData().catch(() => null);
    const hasAccount = form?.get('has_account') === '1';

    const prefill = await goCardlessPrefillFor(supabase, {
      userId: user.id,
      tenantId,
      fallbackEmail: user.email ?? null,
    });

    const url = await startGoCardlessConnect(createAdminClient(), {
      tenantId,
      from: 'web',
      hasAccount,
      prefill,
    });
    return NextResponse.redirect(url, 303);
  } catch (err) {
    console.error('[POST /api/gocardless/connect]', err instanceof Error ? err.message : 'error');
    return settingsRedirect(request, 'error');
  }
}
