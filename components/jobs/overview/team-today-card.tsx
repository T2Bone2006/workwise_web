import Link from 'next/link';
import { UserPlus } from 'lucide-react';
import { Avatar, Tag } from '@/components/look';
import { rowHover } from '@/components/look/row-hover';
import { SectionCard, plural } from '@/components/rounds/overview/shared';
import type { TeamMember } from '@/lib/jobs/pro-day';
import { cn } from '@/lib/utils';

function lineFor(member: TeamMember, isToday: boolean): string {
  if (member.onJob) return member.currentReference ? `On ${member.currentReference}` : 'On a job';
  if (member.total === 0) return isToday ? 'No jobs today' : 'No jobs that day';
  if (member.done >= member.total) return 'All finished';
  return `${plural(member.total - member.done, 'job', 'jobs')} to do`;
}

/** Everyone on the team and how their day is going, so a free worker is easy to spot. */
export function TeamTodayCard({ team, isToday }: { team: TeamMember[]; isToday: boolean }) {
  const out = team.filter((m) => m.onJob).length;
  const free = team.filter((m) => m.total === 0).length;

  return (
    <SectionCard
      title={isToday ? 'Team today' : 'Team that day'}
      summary={
        team.length > 0
          ? `${plural(team.length, 'worker', 'workers')} · ${out} on a job · ${free} with nothing booked`
          : undefined
      }
      action={{ href: '/workers', label: 'Workers' }}
      labelledBy="team-heading"
      className="h-full"
    >
      {team.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl bg-muted/50 px-4 py-8 text-center">
          <UserPlus className="size-7 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold">No workers yet</p>
          <Link href="/workers/new" className="mt-1 text-sm font-medium text-primary hover:underline">
            Invite your first worker
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {team.map((m) => {
            const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
            return (
              <li key={m.id}>
                <Link
                  href={`/workers/${m.id}`}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-2 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    rowHover,
                  )}
                >
                  <Avatar name={m.name} tone={m.onJob ? 'sky' : m.total === 0 ? 'emerald' : 'slate'} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{m.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{lineFor(m, isToday)}</p>
                  </div>
                  {m.total > 0 ? (
                    <div className="w-20 shrink-0 text-right">
                      <p className="text-xs font-medium tabular-nums">
                        {m.done} of {m.total}
                      </p>
                      <span
                        className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${m.name}'s jobs done`}
                      >
                        <span className="block h-full rounded-full bg-(--tone-emerald-solid)" style={{ width: `${pct}%` }} />
                      </span>
                    </div>
                  ) : (
                    <Tag tone="emerald">Free</Tag>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
