import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { createClient } from '@/lib/supabase/server';

interface ByCustomerPageProps {
  params: Promise<{ customerId: string }>;
}

export default async function MessagesByCustomerPage({ params }: ByCustomerPageProps) {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId) redirect('/login');
  if (!products.hasRounds) redirect('/dashboard');

  const { customerId } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('message_threads')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .maybeSingle();

  const threadId =
    data && typeof (data as { id?: unknown }).id === 'string'
      ? (data as { id: string }).id
      : null;

  if (threadId) redirect(`/messages/${threadId}`);
  redirect(`/customers/${customerId}`);
}
