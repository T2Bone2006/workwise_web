import { NextResponse } from 'next/server';
import { startPayByBank, type PayByBankKind } from '@/lib/gocardless/pay-by-bank';
import { appBaseUrl } from '@/lib/payments/tokens';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

function backTo(from: string, token: string, bank: string): NextResponse {
  const path = from === 'invoice' ? `/pay/i/${encodeURIComponent(token)}` : `/pay/${encodeURIComponent(token)}`;
  const url = new URL(path, appBaseUrl());
  url.searchParams.set('bank', bank);
  return NextResponse.redirect(url, 303);
}

/** Pay page "Pay by bank" (D17): form POST → GoCardless's own page. Never a 500. */
export async function POST(request: Request): Promise<NextResponse> {
  let token = '';
  let from = 'customer';
  let kind: PayByBankKind = 'pay_by_bank';
  try {
    const form = await request.formData();
    token = String(form.get('token') ?? '').trim();
    from = String(form.get('from') ?? '') === 'invoice' ? 'invoice' : 'customer';
    if (String(form.get('kind') ?? '') === 'pay_and_dd') kind = 'pay_and_dd';
  } catch {
    return backTo('customer', token, 'not_available');
  }
  if (!token) return backTo(from, token, 'not_available');

  try {
    const admin = createAdminClient();
    const result =
      from === 'invoice'
        ? await startPayByBank(admin, { from: 'invoice', invoiceToken: token })
        : await startPayByBank(admin, { from: 'customer', payToken: token, kind });
    if (result.ok) return NextResponse.redirect(result.url, 303);
    return backTo(from, token, result.reason);
  } catch (err) {
    console.error('[pay/bank]', err instanceof Error ? err.name : 'error');
    return backTo(from, token, 'provider_error');
  }
}
