import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getCustomersForImport } from '@/lib/data/customers';
import { usesProCrm, usesRoundsCrm } from '@/lib/navigation/dashboard-paths';
import { ImportWizard } from '@/components/import/import-wizard';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';

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

export default async function ImportPage() {
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId) {
    return <NoTenantMessage />;
  }

  if (usesRoundsCrm(products)) {
    redirect('/customers');
  }

  if (!usesProCrm(products)) {
    redirect('/dashboard');
  }

  const { customers } = await getCustomersForImport(tenantId);

  return (
    <div className="space-y-6">
      <PageGradientHeader
        title="Import Jobs"
        subtitle="Choose a customer, upload their spreadsheet, review the jobs, then import."
      />
      <ImportWizard tenantId={tenantId} customers={customers} />
    </div>
  );
}
