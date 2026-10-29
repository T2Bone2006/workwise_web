import { Lock } from 'lucide-react';
import { redirect } from 'next/navigation';
import { PortalAttentionList } from '@/components/portal/portal-attention-list';
import { TenantSelector } from '@/components/portal/tenant-selector';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { EmptyState } from '@/components/look/empty-state';
import { getPortalAccess, getPortalAttentionPage, type AttentionKindFilter } from '@/lib/data/portal';

interface PortalAttentionPageProps {
  searchParams: Promise<{ tenant?: string; kind?: string; search?: string; page?: string }>;
}

function parseKind(raw: string | undefined): AttentionKindFilter {
  return raw === 'not_completed' || raw === 'overdue' ? raw : 'all';
}

export default async function PortalAttentionPage({ searchParams }: PortalAttentionPageProps) {
  const raw = await searchParams;
  const access = await getPortalAccess(raw.tenant);

  if (access.status === 'signed_out') redirect('/login');

  if (access.status === 'none') {
    return (
      <div className="space-y-5">
        <PageGradientHeader title="Needs attention" subtitle="Jobs that failed or ran late." />
        <EmptyState
          icon={Lock}
          title="No access"
          body="Your account is not linked to any customer portal. Contact your service provider if you believe this is an error."
        />
      </div>
    );
  }

  const kind = parseKind(raw.kind);
  const page = Math.max(1, parseInt(raw.page ?? '1', 10) || 1);
  const search = raw.search?.trim() ?? '';
  const result = await getPortalAttentionPage(access.customerId, { kind, search, page });
  const several = access.options.length > 1;

  return (
    <PortalAttentionList
      tenantName={access.tenantName}
      kind={kind}
      search={search}
      result={result}
      tenant={several ? access.customerId : undefined}
      actions={several ? <TenantSelector options={access.options} selectedCustomerId={access.customerId} /> : undefined}
    />
  );
}
