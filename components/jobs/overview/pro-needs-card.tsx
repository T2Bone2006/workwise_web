'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  RadioTower,
  UserX,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { IconChip, type Tone } from '@/components/look';
import { rowHover } from '@/components/look/row-hover';
import { SendOutJobsDialog } from '@/components/jobs/send-out-jobs-dialog';
import { Button } from '@/components/ui/button';
import { SectionCard, formatDayMonth, plural } from '@/components/rounds/overview/shared';
import type { TenantSkillRow } from '@/lib/actions/skills';
import type { DeclinedJobItem } from '@/lib/data/dashboard';
import type { PendingSendJobRow } from '@/lib/data/jobs';
import type { ProNeedsData } from '@/lib/data/pro-home';
import { cn } from '@/lib/utils';

type Need = {
  key: string;
  icon: LucideIcon;
  tone: Tone;
  count: number;
  title: string;
  detail: string;
  href?: string;
  /** A button instead of the arrow. */
  button?: { label: string; onClick: () => void };
};

/**
 * Everything waiting on the dispatcher, most pressing first. Replaces the red and
 * blue banners: declined jobs, jobs ready to send, jobs with no worker and jobs
 * that didn't get done. Each line opens the place to deal with it.
 */
export function ProNeedsCard({
  declined,
  pendingSend,
  needs,
  tenantSkills,
  fill = false,
}: {
  /** Stretch to the height of the card beside it. */
  fill?: boolean;
  declined: DeclinedJobItem[];
  pendingSend: PendingSendJobRow[];
  needs: ProNeedsData;
  tenantSkills: TenantSkillRow[];
}) {
  const [sendOpen, setSendOpen] = useState(false);
  const list: Need[] = [];

  const newestDecline = declined[0];
  if (declined.length > 0 && newestDecline) {
    list.push({
      key: 'declined',
      icon: AlertTriangle,
      tone: 'rose',
      count: declined.length,
      title: declined.length === 1 ? 'declined job to reassign' : 'declined jobs to reassign',
      detail: [
        newestDecline.reference_number,
        newestDecline.decline_reason ? `“${newestDecline.decline_reason}”` : null,
        formatDistanceToNow(new Date(newestDecline.updated_at), { addSuffix: true }),
      ]
        .filter(Boolean)
        .join(' · '),
      href: declined.length === 1 ? `/jobs/${newestDecline.id}` : '/jobs?status=declined',
    });
  }
  if (needs.unassigned.count > 0) {
    list.push({
      key: 'unassigned',
      icon: UserX,
      tone: 'amber',
      count: needs.unassigned.count,
      title: needs.unassigned.count === 1 ? 'job with no worker' : 'jobs with no worker',
      detail: needs.unassigned.oldestDate
        ? `Earliest is booked for ${formatDayMonth(needs.unassigned.oldestDate)} · assign them one by one`
        : 'No date set yet · assign them one by one',
      href: '/jobs/review',
    });
  }
  if (pendingSend.length > 0) {
    list.push({
      key: 'send',
      icon: RadioTower,
      tone: 'sky',
      count: pendingSend.length,
      title: pendingSend.length === 1 ? 'job ready to send' : 'jobs ready to send',
      detail: 'Workers are assigned but haven’t been told in the app yet',
      button: { label: 'Send out jobs', onClick: () => setSendOpen(true) },
    });
  }
  if (needs.notCompleted.count > 0) {
    const first = needs.notCompleted.recent[0];
    list.push({
      key: 'incomplete',
      icon: XCircle,
      tone: 'amber',
      count: needs.notCompleted.count,
      title: needs.notCompleted.count === 1 ? 'job not completed' : 'jobs not completed',
      detail: first
        ? `Last 14 days · ${[first.reference, first.address].filter(Boolean).join(', ')}`
        : 'Last 14 days',
      href: '/jobs?status=incomplete',
    });
  }

  return (
    <>
      <SectionCard
        title="Needs you"
        summary={list.length > 0 ? `${plural(list.length, 'thing', 'things')} waiting` : undefined}
        aside={
          list.length > 0 ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900 tabular-nums dark:bg-amber-500/20 dark:text-amber-200">
              {list.length}
            </span>
          ) : null
        }
        labelledBy="pro-needs-heading"
        className={fill ? 'h-full' : undefined}
      >
        {list.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-xl bg-(--tone-emerald-soft) px-4 py-8 text-center">
            <CheckCircle2 className="size-8 text-(--tone-emerald-text)" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold">Nothing needs you. Nice.</p>
            <p className="mt-0.5 text-sm text-muted-foreground">No declined jobs, unassigned jobs or unfinished work.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {list.map((need) => {
              const body = (
                <>
                  <IconChip icon={need.icon} tone={need.tone} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      <span className="tabular-nums">{need.count}</span> {need.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{need.detail}</p>
                  </div>
                </>
              );
              return (
                <li key={need.key}>
                  {need.button ? (
                    <div className={cn('flex items-center gap-3 rounded-xl px-2 py-2', rowHover)}>
                      {body}
                      <Button type="button" size="sm" onClick={need.button.onClick}>
                        <RadioTower className="mr-1.5 size-4" aria-hidden="true" />
                        {need.button.label}
                      </Button>
                    </div>
                  ) : (
                    <Link
                      href={need.href ?? '/jobs'}
                      className={cn(
                        'group flex items-center gap-3 rounded-xl px-2 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        rowHover,
                      )}
                    >
                      {body}
                      <ChevronRight
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
      <SendOutJobsDialog open={sendOpen} onOpenChange={setSendOpen} jobs={pendingSend} tenantSkills={tenantSkills} />
    </>
  );
}
