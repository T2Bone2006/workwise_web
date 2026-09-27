import { notFound, redirect } from 'next/navigation';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { InvoiceDetail } from '@/components/payments/invoice-detail';
import { getInvoice } from '@/lib/data/payments/invoices';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { createClient } from '@/lib/supabase/server';

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);
  if (!tenantId) redirect('/login');
  if (!products.hasRounds) redirect('/dashboard');

  const { id } = await params;
  const supabase = await createClient();
  let invoice;
  try {
    invoice = await getInvoice(supabase, tenantId, id);
  } catch (error) {
    console.error('invoice page', error);
    throw new Error('Could not load the invoice.');
  }
  if (!invoice) notFound();

  return (
    <div className="space-y-6">
      <HistoryBackButton fallbackHref="/payments?tab=invoices" label="Invoices" />
      <PageGradientHeader title={invoice.number} subtitle="Invoice" />
      <InvoiceDetail invoice={invoice} />
    </div>
  );
}
