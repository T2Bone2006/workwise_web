import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { Briefcase, Clock, Edit, Mail, MapPin, Phone } from 'lucide-react';
import { Avatar, EmptyState, Tag, type Tone } from '@/components/look';
import { rowHover } from '@/components/look/row-hover';
import { Kpi } from '@/components/jobs/overview/kpi';
import { SectionCard, plural } from '@/components/rounds/overview/shared';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WorkerAutoAssignToggle } from '@/components/workers/worker-auto-assign-toggle';
import { WorkerPasswordResetButton } from '@/components/workers/worker-password-reset-button';
import { WorkerDeactivateButton } from '@/components/workers/worker-delete-button';
import { WorkerResendInviteButton } from '@/components/workers/worker-resend-invite-button';
import { JOB_STATUS_DISPLAY, type JobStatusUi } from '@/lib/job-status-display';
import { cn } from '@/lib/utils';

const WORKER_STATUS: Record<string, { label: string; tone: Tone }> = {
  available: { label: 'Available', tone: 'emerald' },
  busy: { label: 'Busy', tone: 'amber' },
  unavailable: { label: 'Unavailable', tone: 'rose' },
  off_duty: { label: 'Off duty', tone: 'slate' },
};

const WORKER_TYPE: Record<string, string> = {
  company_subcontractor: 'Subcontractor',
  platform_solo: 'Platform solo',
  both: 'Both',
  employee: 'Employee',
};

export type WorkerDetailJob = {
  id: string;
  reference: string | null;
  address: string | null;
  postcode: string | null;
  status: string;
  scheduledDate: string | null;
  completedAt: string | null;
  customerName: string | null;
};

export type WorkerDetailData = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  userId: string | null;
  /** Invited but hasn't accepted yet: can't be given jobs until they do. */
  invitePending: boolean;
  invite: { id: string; email: string | null; expired: boolean } | null;
  homePostcode: string | null;
  workerType: string | null;
  status: string | null;
  skills: string[];
  createdAt: string;
  excludedFromAutoAssign: boolean;
  counts: { total: number; completed: number; onJob: number; comingUp: number; notCompleted: number; cancelled: number };
  recent: WorkerDetailJob[];
};

function dateLine(job: WorkerDetailJob): string {
  if (job.completedAt) return `Done ${format(parseISO(job.completedAt), 'd MMM')}`;
  if (job.scheduledDate) return `Booked ${format(parseISO(job.scheduledDate), 'EEE d MMM')}`;
  return 'Not scheduled';
}

/** A worker's page in the new look: who they are, how their jobs are going, and what you can do. */
export function WorkerDetailNew({ worker }: { worker: WorkerDetailData }) {
  const { counts } = worker;
  const rate = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;
  const status = WORKER_STATUS[worker.status ?? ''] ?? WORKER_STATUS.off_duty!;
  const memberSince = format(new Date(worker.createdAt), 'MMMM yyyy');

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <HistoryBackButton iconOnly label="Back to workers" fallbackHref="/workers" />
          <Avatar name={worker.fullName} tone="sky" size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-[28px]">{worker.fullName}</h1>
              {worker.invitePending ? <Tag tone="amber">Pending invite</Tag> : <Tag tone={status.tone}>{status.label}</Tag>}
              {worker.workerType ? <Tag tone="slate">{WORKER_TYPE[worker.workerType] ?? worker.workerType}</Tag> : null}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">On the team since {memberSince}</p>
          </div>
        </div>
        <Button asChild>
          <Link href={`/workers/${worker.id}/edit`}>
            <Edit className="mr-2 size-4" aria-hidden="true" />
            Edit worker
          </Link>
        </Button>
      </header>

      {worker.invitePending ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-(--tone-amber-solid)/30 bg-(--tone-amber-solid)/10 px-4 py-3">
          <div className="min-w-0 text-sm">
            <p className="font-semibold">Waiting for {worker.fullName.split(' ')[0]} to accept their invitation</p>
            <p className="text-muted-foreground">
              {worker.invite
                ? `${worker.invite.expired ? 'The invitation to' : 'Invitation sent to'} ${worker.invite.email ?? worker.email ?? 'their email'}${worker.invite.expired ? ' has run out.' : '.'}`
                : 'No invitation is open for them.'}{' '}
              You can give them jobs once they accept.
            </p>
          </div>
          {worker.invite ? <WorkerResendInviteButton inviteId={worker.invite.id} /> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi
          href={`/jobs?f0=assigned_worker_id&v0=${worker.id}&status=completed`}
          label="Done"
          value={String(counts.completed)}
          figure="text-(--tone-emerald-solid)"
          sub={counts.total > 0 ? `${rate}% of ${plural(counts.total, 'job', 'jobs')} finished` : 'No jobs yet'}
        />
        <Kpi
          href={`/jobs?f0=assigned_worker_id&v0=${worker.id}&status=in_progress,paused`}
          label="On a job now"
          value={String(counts.onJob)}
          figure="text-(--tone-sky-solid)"
          sub={counts.onJob > 0 ? 'Active right now' : 'Not on a job'}
        />
        <Kpi
          href={`/jobs?f0=assigned_worker_id&v0=${worker.id}&status=assigned,pending_send`}
          label="Coming up"
          value={String(counts.comingUp)}
          figure="text-foreground"
          sub={counts.comingUp > 0 ? 'Booked, not started' : 'Nothing booked'}
        />
        <Kpi
          href={`/jobs?f0=assigned_worker_id&v0=${worker.id}&status=incomplete`}
          label="Not completed"
          value={String(counts.notCompleted)}
          figure={counts.notCompleted > 0 ? 'text-(--tone-amber-solid)' : 'text-(--tone-emerald-solid)'}
          sub={counts.notCompleted > 0 ? 'Reports where the work did not get done' : 'Everything finished'}
        />
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-5">
        <div className="min-w-0 space-y-4 sm:space-y-5 lg:col-span-3">
          <SectionCard title="Recent jobs" summary="The last 10 jobs assigned to them" action={{ href: `/jobs?f0=assigned_worker_id&v0=${worker.id}`, label: 'All jobs' }} labelledBy="worker-jobs-heading">
            {worker.recent.length === 0 ? (
              <EmptyState icon={Briefcase} title="No jobs assigned yet" body="Jobs you give them will show up here." />
            ) : (
              <ul className="flex flex-col gap-1">
                {worker.recent.map((job) => {
                  const display = JOB_STATUS_DISPLAY[job.status as JobStatusUi];
                  return (
                    <li key={job.id}>
                      <Link
                        href={`/jobs/${job.id}`}
                        className={cn('flex items-center gap-3 rounded-xl px-2 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', rowHover)}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                            {job.reference ?? 'Job'}
                            {display ? <Badge className={cn('text-xs', display.badgeClass)}>{display.label}</Badge> : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[job.address, job.postcode].filter(Boolean).join(', ')}
                            {job.customerName ? ` · ${job.customerName}` : ''}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">{dateLine(job)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0 space-y-4 sm:space-y-5 lg:col-span-2">
          <SectionCard title="Contact" labelledBy="worker-contact-heading">
            <ul className="space-y-2.5 text-sm">
              {worker.phone ? (
                <li className="flex items-center gap-3">
                  <Phone className="size-4 text-muted-foreground" aria-hidden="true" />
                  <a href={`tel:${worker.phone}`} className="hover:underline">{worker.phone}</a>
                </li>
              ) : null}
              {worker.email ? (
                <li className="flex items-center gap-3">
                  <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
                  <a href={`mailto:${worker.email}`} className="truncate hover:underline">{worker.email}</a>
                </li>
              ) : null}
              {worker.homePostcode ? (
                <li className="flex items-center gap-3">
                  <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>Based in {worker.homePostcode}</span>
                </li>
              ) : null}
            </ul>
            {worker.skills.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {worker.skills.map((skill) => (
                  <Tag key={skill} tone="slate" className="capitalize">{skill.replace(/_/g, ' ')}</Tag>
                ))}
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="Actions" labelledBy="worker-actions-heading">
            <div className="space-y-2">
              <div className="rounded-xl border border-border p-3">
                <WorkerAutoAssignToggle workerId={worker.id} initialExcluded={worker.excludedFromAutoAssign} />
              </div>
              {worker.invitePending ? (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  disabled
                  title="They need to accept their invitation first"
                >
                  <Briefcase className="mr-2 size-4" aria-hidden="true" />
                  Assign a new job (after they accept)
                </Button>
              ) : (
                <Button variant="outline" className="w-full justify-start" asChild>
                  <Link href={`/jobs/new?worker=${worker.id}`}>
                    <Briefcase className="mr-2 size-4" aria-hidden="true" />
                    Assign a new job
                  </Link>
                </Button>
              )}
              <Button variant="outline" className="w-full justify-start" asChild>
                <Link href={`/jobs?worker_id=${worker.id}&status=in_progress`}>
                  <Clock className="mr-2 size-4" aria-hidden="true" />
                  See their active jobs
                </Link>
              </Button>
              {worker.userId && worker.email ? <WorkerPasswordResetButton workerId={worker.id} /> : null}
              <WorkerDeactivateButton workerId={worker.id} workerName={worker.fullName} fullWidth />
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
