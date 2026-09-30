import { NextResponse } from 'next/server';
import { loadCustomerPayPage } from '@/lib/data/payments/public-pay';
import { startDirectDebitSetup } from '@/lib/direct-debit/setup';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

function appUrl(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || new URL(request.url).origin;
}

function backToPayPage(request: Request, token: string, param: 'error' | 'dd', value: string): NextResponse {
  const url = new URL(`/pay/${encodeURIComponent(token)}`, appUrl(request));
  url.searchParams.set(param, value);
  return NextResponse.redirect(url, 303);
}

/** Pay page "Set up Direct Debit" (D4): form POST with the pay token → GoCardless's own page. Never a 500. */
export async function POST(request: Request): Promise<NextResponse> {
  let token = '';
  try {
    const form = await request.formData();
    token = String(form.get('token') ?? '').trim();
  } catch {
    token = '';
  }

  try {
    const page = token ? await loadCustomerPayPage(token) : null;
    if (!page) return backToPayPage(request, token, 'error', 'invalid');

    const result = await startDirectDebitSetup(createAdminClient(), {
      tenantId: page.business.tenantId,
      customerId: page.customerId,
      payToken: token,
    });
    if (result.ok) return NextResponse.redirect(result.url, 303);
    return backToPayPage(request, token, 'dd', result.reason);
  } catch (err) {
    console.error('[pay/direct-debit]', err instanceof Error ? err.name : 'error');
    return backToPayPage(request, token, 'dd', 'provider_error');
  }
}
