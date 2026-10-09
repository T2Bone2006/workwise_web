import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, CalendarClock, ClipboardList, MapPin, Phone, User } from 'lucide-react';
import { LookCard, Notice, Tag } from '@/components/look';
import { JobHistoryCard } from '@/components/worker/job-history-card';
import { JobSheetCard } from '@/components/worker/job-sheet-card';
import { PhoneNote } from '@/components/worker/phone-note';
import { toLookTone } from '@/components/worker/tone';
import { Button } from '@/components/ui/button';
import { getMyJob } from '@/lib/data/worker/jobs';
import { directionsHref, telHref } from '@/lib/worker/field-link';
import { FINISHED_STATUSES, isUrgent, workerTag } from '@/lib/worker/status';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function WorkerJobPage({ params, searchParams }: PageProps) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const job = await getMyJob(id);
  if (!job) notFound();

  const tag = workerTag(job);
  const back = tab ? `/worker/jobs?tab=${encodeURIComponent(tab)}` : '/worker/jobs';
  const maps = directionsHref(job.address, job.postcode);
  const tel = telHref(job.customerPhone);
  const where = [job.address, job.postcode].filter(Boolean).join(', ');
  const finished = FINISHED_STATUSES.has(job.status) || job.status === 'declined';

  return (
    <div className="mx-auto max-w-3xl space-y-4 sm:space-y-5">
      <Link
        href={back}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ArrowLeft className="size-4" aria-hidden /> Jobs
      </Link>

      <header className="rounded-2xl bg-gradient-to-br from-(--tone-rounds-soft) via-card to-(--tone-sky-soft) px-5 py-5 ring-1 ring-border">
        <div className="flex flex-wrap items-center gap-2">
          {job.referenceNumber ? (
            <span className="text-xs font-semibold tracking-wide text-(--tone-rounds-text) uppercase">{job.referenceNumber}</span>
          ) : null}
          {isUrgent(job) ? <Tag tone="rose">Urgent</Tag> : null}
          {tag ? <Tag tone={toLookTone(tag.tone)}>{tag.label}</Tag> : null}
        </div>
        <h1 className="mt-2 text-xl leading-snug font-semibold tracking-tight sm:text-2xl">{job.title}</h1>
        {job.customerName && !job.declinedByMe ? <p className="mt-1 text-sm text-muted-foreground">{job.customerName}</p> : null}
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

      {!finished ? <PhoneNote>Accept, start and finish this job in the WorkWise app.</PhoneNote> : null}

      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
        <LookCard title="When" icon={CalendarClock} tone="sky">
          <p className="text-lg font-semibold tracking-tight">
            {job.scheduledDate ? format(parseISO(job.scheduledDate), 'EEEE d MMMM') : 'No day set'}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
            {job.scheduledTime ? `at ${job.scheduledTime}` : 'Any time'}
          </p>
        </LookCard>
        <LookCard title="Where" icon={MapPin} tone="rounds">
          <p className="text-sm font-medium">{where || 'No address'}</p>
          {maps ? (
            <Button variant="outline" size="sm" className="mt-3" asChild>
              <a href={maps} target="_blank" rel="noopener noreferrer">
                Directions
              </a>
            </Button>
          ) : null}
        </LookCard>
      </div>

      <LookCard title="The job" icon={ClipboardList} tone="indigo">
        <p className="text-sm leading-relaxed whitespace-pre-line">{job.description}</p>
      </LookCard>

      <JobSheetCard rows={job.sheet} />

      {!job.declinedByMe && (job.customerName || job.customerPhone) ? (
        <LookCard title="Customer" icon={User} tone="teal">
          {job.customerName ? <p className="text-sm font-medium">{job.customerName}</p> : null}
          {job.customerPhone ? (
            <p className="mt-1 flex items-center gap-2 text-sm">
              <Phone className="size-3.5 text-muted-foreground" aria-hidden />
              {tel ? (
                <a href={tel} className="text-(--tone-rounds-text) underline-offset-4 hover:underline">
                  {job.customerPhone}
                </a>
              ) : (
                <span>{job.customerPhone}</span>
              )}
            </p>
          ) : null}
        </LookCard>
      ) : null}

      <JobHistoryCard lines={job.history} />
    </div>
  );
}
