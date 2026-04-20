'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Briefcase } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { type JobRow, type JobStatus } from '@/lib/data/jobs';
import { JOB_STATUS_DISPLAY } from '@/lib/job-status-display';
import { format, parseISO, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const STATUS_TOOLTIPS: Record<JobStatus, string> = {
  pending: 'In the queue; not yet assigned to a worker.',
  pending_send: 'Worker chosen — send from jobs list to notify their app.',
  assigned: 'Worker assigned — waiting to start on site.',
  in_progress: 'Work is underway.',
  completed: 'Finished.',
  cancelled: 'Cancelled; will not be completed.',
};

function formatScheduledDateTime(dateStr: string | null, timeStr: string | null) {
  if (!dateStr && !timeStr) return '—';
  try {
    const timeShort = timeStr && timeStr.length >= 5 ? timeStr.slice(0, 5) : null;
    if (dateStr) {
      const iso = dateStr.length <= 10 ? `${dateStr}T12:00:00` : dateStr;
      const d = parseISO(iso);
      if (!isValid(d)) return dateStr + (timeShort ? ` · ${timeShort}` : '');
      const datePart = format(d, 'd MMM yyyy');
      return timeShort ? `${datePart} · ${timeShort}` : datePart;
    }
    return timeShort ?? '—';
  } catch {
    return [dateStr, timeStr].filter(Boolean).join(' ') || '—';
  }
}

interface JobsGroupedViewProps {
  jobs: JobRow[];
}

export function JobsGroupedView({ jobs }: JobsGroupedViewProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const byCustomer = useMemo(() => {
    const map = new Map<string | null, { name: string; jobs: JobRow[] }>();
    for (const job of jobs) {
      const key = job.customer_id;
      const name = job.customer_name ?? 'Individual / No customer';
      if (!map.has(key)) map.set(key, { name, jobs: [] });
      map.get(key)!.jobs.push(job);
    }
    return Array.from(map.entries()).map(([customerId, { name, jobs: j }]) => ({
      customerId,
      name,
      jobs: j,
      notStarted: j.filter((x) => x.status === 'pending').length,
      readyToSend: j.filter((x) => x.status === 'pending_send').length,
      inProgress: j.filter((x) => x.status === 'in_progress').length,
      paused: j.filter((x) => x.status === 'assigned').length,
      completed: j.filter((x) => x.status === 'completed').length,
    }));
  }, [jobs]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {byCustomer.map(
        ({
          customerId,
          name,
          jobs: groupJobs,
          notStarted,
          readyToSend,
          inProgress,
          paused,
          completed,
        }) => {
          const key = customerId ?? '__none__';
          const isExpanded = expanded.has(key);
          const chips = [
            { n: notStarted, title: 'Not Started', bar: JOB_STATUS_DISPLAY.pending.summaryBarClass },
            {
              n: readyToSend,
              title: 'Ready to send',
              bar: JOB_STATUS_DISPLAY.pending_send.summaryBarClass,
            },
            { n: inProgress, title: 'In Progress', bar: JOB_STATUS_DISPLAY.in_progress.summaryBarClass },
            { n: paused, title: 'Paused', bar: JOB_STATUS_DISPLAY.assigned.summaryBarClass },
            { n: completed, title: 'Completed', bar: JOB_STATUS_DISPLAY.completed.summaryBarClass },
          ];
          return (
            <Card
              key={key}
              className={cn(
                'glass-card overflow-hidden border-border/80 transition-all duration-300',
                'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
              )}
            >
              <button
                type="button"
                onClick={() => toggle(key)}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/30"
              >
                {isExpanded ? (
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                )}
                <Briefcase className="size-5 shrink-0 text-primary/80" />
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{name}</span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    ({groupJobs.length} job{groupJobs.length !== 1 ? 's' : ''})
                  </span>
                </div>
                <div className="flex max-w-[55%] flex-wrap justify-end gap-2 text-xs sm:max-w-none">
                  {chips.map((c) => (
                    <span
                      key={c.title}
                      className={cn('rounded-md border px-2 py-0.5 font-medium', c.bar)}
                      title={c.title}
                    >
                      {c.n} {c.title}
                    </span>
                  ))}
                </div>
              </button>
              {isExpanded && (
                <CardContent className="border-t border-border/60 p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/80 hover:bg-transparent">
                          <TableHead className="text-muted-foreground">Reference #</TableHead>
                          <TableHead className="text-muted-foreground">Address</TableHead>
                          <TableHead className="text-muted-foreground">Worker</TableHead>
                          <TableHead className="text-muted-foreground">Scheduled</TableHead>
                          <TableHead className="text-muted-foreground">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groupJobs.map((job) => (
                          <TableRow
                            key={job.id}
                            className="cursor-pointer border-border/60 hover:bg-primary/5"
                            onClick={() => router.push(`/jobs/${job.id}`)}
                          >
                            <TableCell className="font-medium">
                              <Link
                                href={`/jobs/${job.id}`}
                                className="text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {job.reference_number || job.id.slice(0, 8)}
                              </Link>
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-muted-foreground">
                              {job.address ?? '—'}
                            </TableCell>
                            <TableCell>
                              {job.worker_name ?? (
                                <span className="text-muted-foreground">Unassigned</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                              {formatScheduledDateTime(job.scheduled_date, job.scheduled_time)}
                            </TableCell>
                            <TableCell>
                              {job.status ? (
                                <span
                                  className={cn(
                                    'inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
                                    JOB_STATUS_DISPLAY[job.status as JobStatus].badgeClass
                                  )}
                                  title={STATUS_TOOLTIPS[job.status as JobStatus]}
                                >
                                  {JOB_STATUS_DISPLAY[job.status as JobStatus].label}
                                </span>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        }
      )}
    </div>
  );
}
