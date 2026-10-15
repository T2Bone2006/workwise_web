import 'server-only';

import { renderToBuffer } from '@react-pdf/renderer';
import { invoiceDocument, type InvoiceLogo } from '@/lib/invoices/pdf/invoice-document';
import type { InvoiceViewModel } from '@/lib/invoices/view-model';

const LOGO_TIMEOUT_MS = 3000;

function logoFormat(
  bytes: Buffer,
  contentType: string | null,
  url: string,
): 'png' | 'jpg' | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  const type = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'image/png') return 'png';
  if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.png')) return 'png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'jpg';
  return null;
}

async function loadLogo(url: string | null): Promise<InvoiceLogo> {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGO_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = Buffer.from(await response.arrayBuffer());
    const format = logoFormat(data, response.headers.get('content-type'), url);
    if (!format || data.length === 0) return null;
    return { data, format };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function renderInvoicePdf(vm: InvoiceViewModel): Promise<Buffer> {
  const logo = await loadLogo(vm.seller.logoUrl);
  return renderToBuffer(invoiceDocument(vm, logo));
}
