import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { ExistingDirectDebits } from '@/components/payments/existing-direct-debits';
import { getExistingDirectDebits } from '@/lib/data/direct-debit/existing';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { createClient } from '@/lib/supabase/server';

export default async function ExistingDirectDebitsPage() {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);
  if (!tenantId) redirect('/login');
  if (!products.hasRounds) notFound();

  const supabase = await createClient();
  const [existing, connection, customers, liveDirectDebits] = await Promise.all([
    getExistingDirectDebits(supabase, tenantId),
    supabase.from('gocardless_connections').select('status').eq('tenant_id', tenantId).maybeSingle(),
    supabase
      .from('customers')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true })
      .limit(5000),
    supabase
      .from('customer_direct_debits')
      .select('customer_id')
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'active']),
  ]);

  const connected = (connection.data as { status?: string } | null)?.status === 'connected';
  // A customer who already has a Direct Debit isn't offered (the server refuses too).
  const taken = new Set(
    ((liveDirectDebits.data ?? []) as { customer_id: string }[]).map((r) => r.customer_id),
  );
  const pickable = ((customers.data ?? []) as { id: string; name: string | null }[])
    .filter((c) => c.name && !taken.has(c.id))
    .map((c) => ({ id: c.id, name: c.name as string }));

  return (
    <div className="space-y-6">
      <HistoryBackButton fallbackHref="/payments" label="Payments" />
      <PageGradientHeader
        title="Existing Direct Debits"
        subtitle="Direct Debits already in your GoCardless account. Linked ones are collected by WorkWise after each visit, just like new ones."
      />
      {connected ? (
        <ExistingDirectDebits data={existing} customers={pickable} />
      ) : (
        <p className="text-sm">
          Connect GoCardless first.{' '}
          <Link href="/settings?tab=payments" className="font-medium text-primary hover:underline">
            Go to Settings → Payments
          </Link>
        </p>
      )}
    </div>
  );
}
