import { NextResponse } from 'next/server';
import { noStore } from '@/lib/accountant/http';
import { requireAccountant } from '@/lib/accountant/context';
import { getInvoice } from '@/lib/data/payments/invoices';
import { renderInvoicePdf } from '@/lib/invoices/render';
import { toInvoiceViewModel } from '@/lib/invoices/view-model';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An invoice of this business as a PDF, exactly as it was issued. `?download=1` saves it instead of showing it. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string; invoiceId: string }> }) {
  const { token, invoiceId } = await params;
  const state = await requireAccountant(token);
  if (state.status === 'not_found') return noStore(new NextResponse(null, { status: 404 }));
  if (state.status === 'sign_in') {
    return noStore(NextResponse.redirect(new URL(`/accountant/${encodeURIComponent(token)}`, request.url), 302));
  }
  if (!UUID_RE.test(invoiceId)) return noStore(new NextResponse(null, { status: 404 }));

  try {
    const invoice = await getInvoice(createAdminClient(), state.ctx.tenantId, invoiceId);
    if (!invoice) return noStore(new NextResponse(null, { status: 404 }));

    // No pay-by-card link: an accountant has nothing to pay.
    const vm = toInvoiceViewModel(invoice, { cardUrl: null });
    const pdf = await renderInvoicePdf(vm);
    const filename = `${invoice.number.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
    return noStore(
      new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${filename}"`,
        },
      }),
    );
  } catch {
    console.error('[accountant:invoice] could not build the PDF');
    return noStore(new NextResponse(null, { status: 500 }));
  }
}
