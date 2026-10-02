import { redirect } from 'next/navigation';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { getCustomersForImport } from '@/lib/data/customers';
import { usesProCrm, usesRoundsCrm } from '@/lib/navigation/dashboard-paths';
import { ImportWizard } from '@/components/import/import-wizard';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { RoundsImportWizard } from '@/components/import/rounds/rounds-import-wizard';
import { createClient } from '@/lib/supabase/server';
import { isTenantAdmin } from '@/lib/stripe/connect';

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

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ pro?: string }>;
}) {
  const { pro } = await searchParams;
  const [tenantId, products] = await Promise.all([
    getTenantIdForCurrentUser(),
    getTenantProducts(),
  ]);

  if (!tenantId) {
    return <NoTenantMessage />;
  }

  // Rounds gets its own import (customers, schedules, owed from before). A business
  // that also has Pro can reach the job import with ?pro=1.
  if (usesRoundsCrm(products) && !(pro === '1' && usesProCrm(products))) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const isOwner = user?.id ? await isTenantAdmin(supabase, user.id) : false;

    return (
      <div className="space-y-6">
        <PageGradientHeader
          title="Import customers"
          subtitle="Bring your round over from a spreadsheet, another app, or your round book."
        />
        {isOwner ? (
          <RoundsImportWizard proImportHref={usesProCrm(products) ? '/import?pro=1' : undefined} />
        ) : (
          <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
            Only the account owner can import customers.
          </p>
        )}
      </div>
    );
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
