import Link from 'next/link';
import { format } from 'date-fns';
import { Briefcase, Edit, FileText, Mail, MapPin, Phone } from 'lucide-react';
import { Avatar, EmptyState, Tag } from '@/components/look';
import { rowHover } from '@/components/look/row-hover';
import { Kpi } from '@/components/jobs/overview/kpi';
import { SectionCard, plural } from '@/components/rounds/overview/shared';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CustomerDeleteButton } from '@/components/customers/customer-delete-button';
import { CustomerPortalCard, type CustomerPortalCardProps } from '@/components/customers/customer-portal-card';
import type { CustomerDetailRow, CustomerJobStats } from '@/lib/data/customers';
import type { RecentJobRow } from '@/lib/data/jobs';
import { JOB_STATUS_DISPLAY, type JobStatusUi } from '@/lib/job-status-display';
import { paths } from '@/lib/navigation/dashboard-paths';
import { cn } from '@/lib/utils';

/**
 * A Pro customer's page in the new look: who they are, how their jobs are going, and, front and
 * centre, whether they can log in to the portal and the button that gives them a login.
 */
export function CustomerDetailNew({
  customer,
  stats,
  recentJobs,
  jobsError,
  portal,
}: {
  customer: CustomerDetailRow;
  stats: CustomerJobStats;
  recentJobs: RecentJobRow[];
  jobsError: Error | null;
  portal: Omit<CustomerPortalCardProps, 'customerId' | 'customerName' | 'email'> | null;
}) {
  const isBulk = customer.type === 'bulk_client';
  const jobsHref = `/jobs?customer_id=${customer.id}`;
  const finishedPct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <HistoryBackButton iconOnly label="Back to customers" fallbackHref={paths.customers} />
          <Avatar name={customer.name} tone={isBulk ? 'violet' : 'emerald'} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-[28px]">{customer.name}</h1>
              <Tag tone={isBulk ? 'violet' : 'emerald'}>{isBulk ? 'Bulk client' : 'Individual'}</Tag>
              {portal?.status === 'active' ? <Tag tone="emerald">Portal access</Tag> : null}
              {portal?.status === 'invited' ? <Tag tone="amber">Portal invite sent</Tag> : null}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {stats.total > 0 ? `${plural(stats.total, 'job', 'jobs')} so far, ${finishedPct}% finished` : 'No jobs yet'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={`/jobs/new?customer_id=${customer.id}`}>
              <Briefcase className="mr-2 size-4" aria-hidden="true" />
              New job
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/customers/${customer.id}/edit`}>
              <Edit className="mr-2 size-4" aria-hidden="true" />
              Edit customer
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi
          href={`${jobsHref}&status=completed`}
          label="Done"
          value={String(stats.completed)}
          figure="text-(--tone-emerald-solid)"
          sub={stats.total > 0 ? `${finishedPct}% of ${plural(stats.total, 'job', 'jobs')}` : 'No jobs yet'}
        />
        <Kpi
          href={`${jobsHref}&status=in_progress`}
          label="In progress"
          value={String(stats.in_progress)}
          figure="text-(--tone-sky-solid)"
          sub={stats.in_progress > 0 ? 'Being worked on now' : 'Nothing on right now'}
        />
        <Kpi
          href={`${jobsHref}&status=pending,assigned,pending_send`}
          label="Waiting"
          value={String(stats.pending + stats.assigned)}
          figure="text-foreground"
          sub={stats.pending + stats.assigned > 0 ? 'Not started yet' : 'Nothing waiting'}
        />
        <Kpi
          href={`${jobsHref}&status=cancelled`}
          label="Cancelled"
          value={String(stats.cancelled)}
          figure={stats.cancelled > 0 ? 'text-(--tone-rose-solid)' : 'text-foreground'}
          sub={stats.cancelled > 0 ? 'Called off' : 'None cancelled'}
        />
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-5">
        <div className="min-w-0 space-y-4 sm:space-y-5 lg:col-span-3">
          <SectionCard
            title="Recent jobs"
            summary="Their latest 10"
            action={{ href: jobsHref, label: 'All jobs' }}
            labelledBy="customer-jobs-heading"
          >
            {jobsError ? (
              <p className="text-sm text-destructive">Couldn&apos;t load their jobs.</p>
            ) : recentJobs.length === 0 ? (
              <EmptyState icon={Briefcase} title="No jobs yet" body="Jobs you create or import for them will show up here." />
            ) : (
              <ul className="flex flex-col gap-1">
                {recentJobs.map((job) => {
                  const display = JOB_STATUS_DISPLAY[job.status as JobStatusUi];
                  return (
                    <li key={job.id}>
                      <Link
                        href={`/jobs/${job.id}`}
                        className={cn('flex items-center gap-3 rounded-xl px-2 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', rowHover)}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                            {job.reference_number || job.id.slice(0, 8)}
                            {display ? <Badge className={cn('text-xs', display.badgeClass)}>{display.label}</Badge> : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{job.address || 'No address'}</p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">{format(new Date(job.created_at), 'd MMM yyyy')}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-4 sm:space-y-5 lg:col-span-2">
          {portal ? (
            <CustomerPortalCard
              customerId={customer.id}
              customerName={customer.name}
              email={customer.email}
              status={portal.status}
              pending={portal.pending}
            />
          ) : (
            <SectionCard title="Customer portal" labelledBy="customer-portal-heading">
              <p className="text-sm text-muted-foreground">Couldn&apos;t check their portal access. Refresh the page to try again.</p>
            </SectionCard>
          )}

          <SectionCard title="Contact" labelledBy="customer-contact-heading">
            <ul className="space-y-2.5 text-sm">
              {customer.email ? (
                <li className="flex items-center gap-3">
                  <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <a href={`mailto:${customer.email}`} className="truncate hover:underline">{customer.email}</a>
                </li>
              ) : null}
              {customer.phone ? (
                <li className="flex items-center gap-3">
                  <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <a href={`tel:${customer.phone}`} className="hover:underline">{customer.phone}</a>
                </li>
              ) : null}
              {customer.address ? (
                <li className="flex items-center gap-3">
                  <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span>{customer.address}</span>
                </li>
              ) : null}
              {customer.notes ? (
                <li className="flex items-start gap-3 border-t border-border pt-2.5">
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="whitespace-pre-wrap text-muted-foreground">{customer.notes}</span>
                </li>
              ) : null}
              {!customer.email && !customer.phone && !customer.address && !customer.notes ? (
                <li className="text-muted-foreground">No contact details yet.</li>
              ) : null}
            </ul>
          </SectionCard>

          <div className="flex justify-end">
            <CustomerDeleteButton customerId={customer.id} customerName={customer.name} useDeactivate />
          </div>
        </div>
      </div>
    </div>
  );
}
