import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { buildLeadPrefill, type LeadPrefill } from '@/lib/lite/leads-core';
import { usesProCrm, usesRoundsCrm, paths } from '@/lib/navigation/dashboard-paths';
import { createClient } from '@/lib/supabase/server';
import { CustomerForm } from '@/components/customers/customer-form';
import { HistoryBackButton } from '@/components/layout/history-back-button';

const LEAD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function prefillFromLead(tenantId: string, fromLead: string | undefined): Promise<LeadPrefill | undefined> {
  if (!fromLead || !LEAD_UUID.test(fromLead)) return undefined;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('leads')
    .select('id, name, phone, email, postcode, job_summary, agreed_amount, status, converted_customer_id, converted_job_id')
    .eq('id', fromLead)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return undefined;
  const row = data as {
    id?: unknown;
    name?: unknown;
    phone?: unknown;
    email?: unknown;
    postcode?: unknown;
    job_summary?: unknown;
    agreed_amount?: unknown;
    status?: unknown;
    converted_customer_id?: unknown;
    converted_job_id?: unknown;
  };
  if (row.status !== 'won') return undefined;
  if (row.converted_customer_id || row.converted_job_id) return undefined;
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return undefined;
  return buildLeadPrefill({
    id: row.id,
    name: row.name,
    phone: typeof row.phone === 'string' ? row.phone : null,
    email: typeof row.email === 'string' ? row.email : null,
    postcode: typeof row.postcode === 'string' ? row.postcode : null,
    job_summary: typeof row.job_summary === 'string' ? row.job_summary : null,
    agreed_amount: row.agreed_amount,
  });
}

function NoTenantMessage() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <h2 className="text-lg font-semibold text-foreground">No tenant assigned</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your account is not linked to a tenant. Please contact your administrator.
      </p>
    </div>
  );
}

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ fromLead?: string }>;
}) {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId) {
    return <NoTenantMessage />;
  }

  if (usesRoundsCrm(products)) {
    const { fromLead } = await searchParams;
    const prefill = await prefillFromLead(tenantId, fromLead);
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <HistoryBackButton iconOnly label="Back to customers" fallbackHref={paths.customers} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Add customer
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Name, phone, and address — you&apos;ll add their service on the next screen.
            </p>
          </div>
        </div>
        <CustomerForm mode="create" variant="rounds" tenantId={tenantId} prefill={prefill} />
      </div>
    );
  }

  if (!usesProCrm(products)) {
    redirect('/dashboard');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <HistoryBackButton iconOnly label="Back to customers" fallbackHref={paths.customers} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Add Customer
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a new bulk client or individual customer
          </p>
        </div>
      </div>
      <CustomerForm mode="create" tenantId={tenantId} />
    </div>
  );
}
