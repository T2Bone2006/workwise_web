import { NextResponse } from 'next/server';
import { getInvoice } from '@/lib/data/payments/invoices';
import { getPaymentSettings } from '@/lib/data/payments/settings';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { renderInvoicePdf } from '@/lib/invoices/render';
import { toInvoiceViewModel } from '@/lib/invoices/view-model';
import { invoiceLinkUrl } from '@/lib/payments/tokens';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function pdfResponse(pdf: Buffer, filename: string, download: boolean): NextResponse {
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) {
    return new NextResponse(null, { status: 404 });
  }

  let invoice;
  try {
    invoice = await getInvoice(supabase, tenantId, id);
  } catch (error) {
    console.error('invoice pdf failed', error);
    return new NextResponse(null, { status: 500 });
  }
  if (!invoice) {
    return new NextResponse(null, { status: 404 });
  }

  const download = new URL(request.url).searchParams.get('download') === '1';
  const settings = await getPaymentSettings(supabase, tenantId);
  const pdf = await renderInvoicePdf(
    toInvoiceViewModel(invoice, {
      cardUrl:
        settings.connect.status === 'active' ? invoiceLinkUrl(invoice.publicToken) : null,
    }),
  );
  return pdfResponse(pdf, `${invoice.number}.pdf`, download);
}
