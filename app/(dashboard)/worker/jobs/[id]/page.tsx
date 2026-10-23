import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, CalendarClock, ClipboardList, MapPin, MessageSquare, Navigation, Phone, User } from 'lucide-react';
import { LookCard, Notice, Tag } from '@/components/look';
import { JobActionPanel } from '@/components/worker/job-action-panel';
import { JobHistoryCard } from '@/components/worker/job-history-card';
import { JobSheetCard } from '@/components/worker/job-sheet-card';
import { RoundsVisitCard } from '@/components/worker/rounds-visit-card';
import { toLookTone } from '@/components/worker/tone';
import { Button } from '@/components/ui/button';
import { getWorkerLink } from '@/lib/auth/worker-link';
import { getMyJob } from '@/lib/data/worker/jobs';
import { directionsHref, smsHref, telHref } from '@/lib/worker/field-link';
import { isUrgent, workerTag } from '@/lib/worker/status';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function WorkerJobPage({ params, searchParams }: PageProps) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const [job, link] = await Promise.all([getMyJob(id), getWorkerLink()]);
  if (!job) notFound();

  const tag = workerTag(job);
  const back = tab ? `/worker/jobs?tab=${encodeURIComponent(tab)}` : '/worker/jobs';
  const maps = directionsHref(job.address, job.postcode);
  const tel = telHref(job.customerPhone);
  const sms = smsHref(job.customerPhone);
  const where = [job.address, job.postcode].filter(Boolean).join(', ');

  return (
    <div className="mx-auto max-w-5xl space-y-4 sm:space-y-5">
      <Link
        href={back}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ArrowLeft className="size-4" aria-hidden /> Jobs
      </Link>

      <header>
        <div className="flex flex-wrap items-center gap-2">
          {tag ? <Tag tone={toLookTone(tag.tone)}>{tag.label}</Tag> : null}
          {isUrgent(job) ? <Tag tone="rose">Urgent</Tag> : null}
          {job.referenceNumber ? <span className="text-sm text-muted-foreground tabular-nums">{job.referenceNumber}</span> : null}
        </div>
        <h1 className="mt-2 text-2xl leading-tight font-semibold tracking-tight sm:text-[28px]">{job.title}</h1>
        {job.customerName && !job.declinedByMe ? <p className="mt-1 text-sm text-muted-foreground">for {job.customerName}</p> : null}
      </header>

      {job.declinedByMe ? (
        <Notice tone="rose" icon={ClipboardList} title="You declined this job">
          It is no longer yours, so the customer and job sheet are hidden.
        </Notice>
      ) : null}

      {job.status === 'incomplete' && job.notBecause ? (
        <Notice tone="amber" icon={ClipboardList} title="This job was not completed">
          {job.notBecause}
        </Notice>
      ) : null}

      <JobActionPanel job={job} employerName={link?.employerName ?? null} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start sm:gap-5">
        <div className="order-2 space-y-4 sm:space-y-5 lg:order-1">
          <LookCard title="The job" icon={ClipboardList} tone="indigo">
            <p className="text-sm leading-relaxed whitespace-pre-line">{job.description}</p>
          </LookCard>

          {job.rounds && !job.declinedByMe ? (
            <RoundsVisitCard price={job.price ?? null} phone={job.customerPhone} accessNotes={job.accessNotes ?? null} />
          ) : null}

          <JobSheetCard rows={job.sheet} />
          <JobHistoryCard lines={job.history} />
        </div>

        <div className="order-1 space-y-4 sm:space-y-5 lg:order-2">
          <LookCard title="When and where" icon={CalendarClock} tone="sky">
            <p className="text-lg font-semibold tracking-tight">
              {job.scheduledDate ? format(parseISO(job.scheduledDate), 'EEEE d MMMM') : 'No day set'}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
              {job.scheduledTime ? `at ${job.scheduledTime}` : 'Any time'}
            </p>
            <div className="mt-4 border-t border-border pt-4">
              <p className="flex items-start gap-2 text-sm font-medium">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>{where || 'No address'}</span>
              </p>
              {maps ? (
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <a href={maps} target="_blank" rel="noopener noreferrer">
                    <Navigation /> Directions
                  </a>
                </Button>
              ) : null}
            </div>
          </LookCard>

          {!job.declinedByMe && (job.customerName || job.customerPhone) ? (
            <LookCard title="Customer" icon={User} tone="teal">
              {job.customerName ? <p className="text-sm font-medium">{job.customerName}</p> : null}
              {job.customerPhone ? (
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="size-3.5" aria-hidden />
                  <span className="tabular-nums">{job.customerPhone}</span>
                </p>
              ) : null}
              {!job.rounds && (tel || sms) ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {tel ? (
                    <Button asChild size="sm">
                      <a href={tel}>
                        <Phone /> Call
                      </a>
                    </Button>
                  ) : null}
                  {sms ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={sms}>
                        <MessageSquare /> Text
                      </a>
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </LookCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
