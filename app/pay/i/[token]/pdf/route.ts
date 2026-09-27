import { NextResponse } from 'next/server';
import { loadInvoiceByToken } from '@/lib/data/payments/public-pay';
import { renderInvoicePdf } from '@/lib/invoices/render';
import { toInvoiceViewModel } from '@/lib/invoices/view-model';
import { invoiceLinkUrl } from '@/lib/payments/tokens';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  let loaded;
  try {
    loaded = await loadInvoiceByToken(token);
  } catch (error) {
    console.error('public invoice pdf failed', error);
    return new NextResponse(null, { status: 500 });
  }
  if (!loaded) {
    return new NextResponse(null, { status: 404 });
  }

  const download = new URL(request.url).searchParams.get('download') === '1';
  const pdf = await renderInvoicePdf(
    toInvoiceViewModel(loaded.invoice, {
      cardUrl: loaded.card.enabled ? invoiceLinkUrl(loaded.invoice.publicToken) : null,
    }),
  );
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${loaded.invoice.number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
