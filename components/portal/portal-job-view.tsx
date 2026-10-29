import Link from 'next/link';
import type { ReactNode } from 'react';
import { CalendarClock, CircleCheck, Clock, Download, FileText, History, ImageIcon, Paperclip, Pause, Ban, TriangleAlert, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LookCard, LookPage, Notice } from '@/components/look';
import { toneClasses, type Tone } from '@/components/look/tones';
import { formatDay, formatStamp, formatTimeOfDay, minutesBetween, stampParts } from '@/lib/portal/dates';
import type { TimelineEvent } from '@/lib/portal/timeline';
import type { PortalJobView } from '@/lib/portal/job';

export type { PortalJobView };


export type Outcome = { tone: Tone; icon: LucideIcon; title: string; body: string | null };

export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${h} h ${m} min`;
}

/** The one sentence that answers "what happened with this job?". */
export function outcomeFor(job: PortalJobView): Outcome {
  const engineer = job.engineerFirstName;
  const booked = job.scheduledDate
    ? `${formatDay(job.scheduledDate)}${formatTimeOfDay(job.scheduledTime) ? ` at ${formatTimeOfDay(job.scheduledTime)}` : ''}`
    : null;

  switch (job.status) {
    case 'completed': {
      const stamp = formatStamp(job.completedAt);
      const mins = minutesBetween(job.arrivedAt, job.completedAt);
      const parts = [
        engineer ? `Attended by ${engineer}.` : null,
        mins != null ? `On site for ${duration(mins)}.` : null,
      ].filter(Boolean);
      return {
        tone: 'emerald',
        icon: CircleCheck,
        title: stamp ? `Completed ${stamp}` : 'Completed',
        body: parts.length > 0 ? parts.join(' ') : null,
      };
    }
    case 'incomplete':
      return {
        tone: 'rose',
        icon: TriangleAlert,
        title: 'Not completed',
        body: job.reason ?? 'The engineer couldn’t finish this visit, and no reason was written down.',
      };
    case 'in_progress': {
      const arrived = stampParts(job.arrivedAt);
      return {
        tone: 'sky',
        icon: Clock,
        title: 'Work in progress',
        body: arrived ? `${engineer ?? 'The engineer'} arrived at ${arrived.time}.` : null,
      };
    }
    case 'paused':
      return { tone: 'amber', icon: Pause, title: 'Work paused', body: engineer ? `${engineer} has paused this visit.` : null };
    case 'assigned':
    case 'accepted':
      return {
        tone: 'indigo',
        icon: CalendarClock,
        title: booked ? `Booked for ${booked}` : 'Booked',
        body: engineer ? `${engineer} is assigned to this visit.` : null,
      };
    case 'declined':
      return { tone: 'slate', icon: UserRound, title: 'Being reassigned', body: 'Your provider is arranging another engineer.' };
    case 'cancelled':
      return { tone: 'slate', icon: Ban, title: 'Cancelled', body: null };
    default:
      return {
        tone: 'slate',
        icon: CalendarClock,
        title: booked ? `Planned for ${booked}` : 'Waiting to be booked',
        body: booked ? null : 'Your provider hasn’t set a date for this job yet.',
      };
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm text-foreground">{children}</div>
    </div>
  );
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative flex flex-col">
      {events.map((event, i) => {
        const parts = stampParts(event.at);
        const last = i === events.length - 1;
        return (
          <li key={event.key} className="relative flex gap-3.5 pb-5 last:pb-0">
            {!last ? <span className="absolute top-4 bottom-0 left-[5px] w-px bg-border" aria-hidden /> : null}
            <span className={cn('relative mt-1.5 size-[11px] shrink-0 rounded-full ring-4 ring-card', toneClasses(event.tone).solid)} aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">{event.label}</p>
              {parts ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {parts.date}, {parts.time}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function PortalJobPage({
  job,
  tenantName,
  timeline,
  photos,
  documents,
  back,
}: {
  job: PortalJobView;
  tenantName: string;
  timeline: TimelineEvent[];
  photos: Array<{ id: string; url: string; name: string }>;
  documents: Array<{ id: string; url: string; name: string }>;
  back: ReactNode;
}) {
  const outcome = outcomeFor(job);
  const hasSchedule = Boolean(job.scheduledDate || job.scheduledTime);
  const scheduled = job.scheduledDate
    ? `${formatDay(job.scheduledDate)}${formatTimeOfDay(job.scheduledTime) ? ` at ${formatTimeOfDay(job.scheduledTime)}` : ''}`
    : (formatTimeOfDay(job.scheduledTime) ?? '—');

  return (
    <div className="flex flex-col gap-5">
      {back}

      <LookPage
        title={job.reference}
        subtitle={job.address || undefined}
        actions={
          <Link
            href={`/portal/jobs/${job.id}/report`}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-xs hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Download className="size-4" aria-hidden />
            Save as PDF
          </Link>
        }
      >
        <Notice tone={outcome.tone} icon={outcome.icon} title={outcome.title}>
          {outcome.body}
        </Notice>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            {photos.length > 0 ? (
              <LookCard title="Photos" icon={ImageIcon} tone="slate" aside={`${photos.length} from the visit`}>
                <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {photos.map((photo) => (
                    <li key={photo.id}>
                      <a
                        href={photo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative block aspect-square h-full w-full overflow-hidden rounded-xl bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.url}
                          alt={photo.name}
                          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          loading="lazy"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </LookCard>
            ) : null}

            <LookCard title="What happened" icon={History} tone="sky">
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing has happened on this job yet.</p>
              ) : (
                <Timeline events={timeline} />
              )}
            </LookCard>
          </div>

          <div className="flex flex-col gap-4">
            <LookCard title="Job details" icon={FileText} tone="rounds">
              <Field label="Provider">
                <p className="font-medium">{tenantName}</p>
              </Field>
              <Field label="Address">
                <p className="font-medium">{job.address || '—'}</p>
              </Field>
              <Field label="Booked for">
                <p className="font-medium">{hasSchedule ? scheduled : '—'}</p>
              </Field>
              {job.engineerFirstName ? (
                <Field label="Engineer">
                  <p className="font-medium">{job.engineerFirstName}</p>
                </Field>
              ) : null}
              <Field label="Work requested">
                <p className="whitespace-pre-wrap">{job.description || '—'}</p>
              </Field>
              {job.completionNotes ? (
                <Field label="Notes from the engineer">
                  <p className="whitespace-pre-wrap">{job.completionNotes}</p>
                </Field>
              ) : null}
            </LookCard>

            {documents.length > 0 ? (
              <LookCard title="Documents" icon={Paperclip} tone="slate" aside={documents.length}>
                <ul className="divide-y divide-border">
                  {documents.map((file) => (
                    <li key={file.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="truncate text-sm font-medium">{file.name}</span>
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-sm font-medium text-primary hover:underline"
                      >
                        Open
                      </a>
                    </li>
                  ))}
                </ul>
              </LookCard>
            ) : null}
          </div>
        </div>
      </LookPage>
    </div>
  );
}
