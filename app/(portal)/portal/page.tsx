import Link from 'next/link';
import { format } from 'date-fns';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TenantSelector, type PortalTenantOption } from '@/components/portal/tenant-selector';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { JOB_STATUS_DISPLAY, type JobStatusUi } from '@/lib/job-status-display';
import { cn } from '@/lib/utils';

type PortalJobRow = {
  id: string;
  reference_number: string;
  address: string;
  status: string | null;
  scheduled_date: string | null;
  updated_at: string | null;
  customer_id: string | null;
};

type TenantRef = { id: string; name: string };
type CustomerRef = {
  id: string;
  name: string;
  tenant_id: string;
  tenants: TenantRef | TenantRef[] | null;
};

function normalizeCustomer(
  raw: CustomerRef | CustomerRef[] | null | undefined
): CustomerRef | null {
  if (!raw) return null;
  const customer = Array.isArray(raw) ? raw[0] : raw;
  if (!customer?.id) return null;
  return customer;
}

function formatDateValue(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'dd MMM yyyy');
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'dd MMM yyyy');
}

function resolveTenantName(tenants: CustomerRef['tenants']): string {
  if (!tenants) return 'Unknown';
  if (Array.isArray(tenants)) {
    return tenants[0]?.name?.trim() || 'Unknown';
  }
  return tenants.name?.trim() || 'Unknown';
}

interface PortalPageProps {
  searchParams: Promise<{ tenant?: string }>;
}

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/portal/login');
  }

  const { data: portalRows, error: portalError } = await supabase
    .from('customer_portal_users')
    .select(
      `
      customer_id,
      customers (
        id,
        name,
        tenant_id,
        tenants (
          id,
          name
        )
      )
    `
    )
    .eq('user_id', user.id);

  if (portalError) {
    console.error('[PortalPage] customer_portal_users:', portalError);
  }

  const tenantOptions: PortalTenantOption[] = (portalRows ?? [])
    .map((row) => {
      const record = row as { customers?: CustomerRef | CustomerRef[] | null };
      const customer = normalizeCustomer(record.customers);
      if (!customer) return null;
      return {
        customerId: customer.id,
        tenantName: resolveTenantName(customer.tenants),
      };
    })
    .filter((option): option is PortalTenantOption => option !== null);

  if (tenantOptions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border/80 bg-muted/20 px-6 py-16 text-center">
        <h1 className="text-lg font-semibold text-foreground">No access</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Your account is not linked to any customer portal. Contact your service provider if you
          believe this is an error.
        </p>
      </div>
    );
  }

  const raw = await searchParams;
  const tenantParam = raw.tenant?.trim();
  const selectedCustomerId =
    tenantParam && tenantOptions.some((o) => o.customerId === tenantParam)
      ? tenantParam
      : tenantOptions[0]!.customerId;

  const selectedTenantName =
    tenantOptions.find((o) => o.customerId === selectedCustomerId)?.tenantName ?? 'Unknown';

  await supabase
    .from('customers')
    .update({ portal_last_accessed_at: new Date().toISOString() })
    .eq('id', selectedCustomerId);

  const { data: jobs } = await supabase
    .from('jobs')
    .select(
      'id, reference_number, address, status, scheduled_date, updated_at, customer_id'
    )
    .eq('customer_id', selectedCustomerId)
    .order('created_at', { ascending: false });

  const jobRows: PortalJobRow[] = Array.isArray(jobs) ? (jobs as PortalJobRow[]) : [];
  const jobCount = jobRows.length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Your Jobs</h1>
        {tenantOptions.length > 1 ? (
          <TenantSelector options={tenantOptions} selectedCustomerId={selectedCustomerId} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Viewing jobs for <span className="font-medium text-foreground">{selectedTenantName}</span>
          </p>
        )}
      </div>

      <Card className="glass-card overflow-hidden border-border/80 backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]">
        <CardContent className="pt-6">
          <p className="mb-4 text-sm text-muted-foreground">
            {jobCount === 1 ? '1 job' : `${jobCount} jobs`}
          </p>

          {jobRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No jobs found</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/80 hover:bg-transparent">
                    <TableHead className="text-muted-foreground font-medium">Reference</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Address</TableHead>
                    <TableHead className="text-muted-foreground font-medium">Status</TableHead>
                    <TableHead className="text-muted-foreground font-medium">
                      Scheduled Date
                    </TableHead>
                    <TableHead className="text-muted-foreground font-medium">
                      Last Updated
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobRows.map((job) => {
                    const statusKey = (job.status ?? 'pending') as JobStatusUi;
                    const statusUi = JOB_STATUS_DISPLAY[statusKey];
                    return (
                      <TableRow
                        key={job.id}
                        className="border-border/80 hover:bg-muted/30 cursor-pointer"
                      >
                        <TableCell className="font-medium">
                          <Link
                            href={`/portal/jobs/${job.id}`}
                            className="text-primary hover:underline"
                          >
                            {job.reference_number || job.id.slice(0, 8)}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-[240px]">
                          <Link
                            href={`/portal/jobs/${job.id}`}
                            className="block truncate text-foreground hover:underline"
                          >
                            {job.address || '—'}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link href={`/portal/jobs/${job.id}`} className="inline-block">
                            <span
                              className={cn(
                                'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm',
                                statusUi?.badgeClass ??
                                  'border-slate-400/60 bg-slate-500/10 text-slate-800 dark:text-slate-200'
                              )}
                            >
                              {statusUi?.label ?? job.status ?? 'Unknown'}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/portal/jobs/${job.id}`}
                            className="text-foreground hover:underline"
                          >
                            {formatDateValue(job.scheduled_date)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/portal/jobs/${job.id}`}
                            className="text-foreground hover:underline"
                          >
                            {formatUpdatedAt(job.updated_at)}
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
