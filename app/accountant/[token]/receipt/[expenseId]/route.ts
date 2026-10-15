import { NextResponse } from 'next/server';
import { noStore } from '@/lib/accountant/http';
import { requireAccountant } from '@/lib/accountant/context';
import { accountantReceiptPath } from '@/lib/data/accountant';
import { RECEIPT_BUCKET } from '@/lib/expenses/read-receipt';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_URL_SECONDS = 300;

/** A receipt photo of this business's saved expense, as a 5-minute link. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string; expenseId: string }> }) {
  const { token, expenseId } = await params;
  const state = await requireAccountant(token);
  if (state.status === 'not_found') return noStore(new NextResponse(null, { status: 404 }));
  if (state.status === 'sign_in') {
    return noStore(NextResponse.redirect(new URL(`/accountant/${encodeURIComponent(token)}`, request.url), 302));
  }
  if (!UUID_RE.test(expenseId)) return noStore(new NextResponse(null, { status: 404 }));

  const admin = createAdminClient();
  const path = await accountantReceiptPath(admin, state.ctx.tenantId, expenseId);
  if (!path) return noStore(new NextResponse(null, { status: 404 }));

  const { data, error } = await admin.storage.from(RECEIPT_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) return noStore(new NextResponse(null, { status: 404 }));
  return noStore(NextResponse.redirect(data.signedUrl, 302));
}
