import { Kpi } from '@/components/jobs/overview/kpi';
import { namesLine, type TeamMember } from '@/lib/jobs/pro-day';

/**
 * The four things a dispatcher wants to know about the team before picking
 * who to send: how many there are, who is out, who is free and how booked the day is.
 */
export function WorkersKpiTiles({
  team,
  invitesWaiting,
  teamSize,
}: {
  team: TeamMember[];
  invitesWaiting: number;
  /** Everyone on the team who has accepted, including those marked busy or off duty. Falls back to the assignable list. */
  teamSize?: number | null;
}) {
  const onJob = team.filter((m) => m.onJob);
  const free = team.filter((m) => m.total === 0);
  const booked = team.reduce((sum, m) => sum + m.total, 0);
  const working = team.filter((m) => m.total > 0).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <Kpi
        href="/workers"
        label="On the team"
        value={String(teamSize ?? team.length)}
        figure="text-foreground"
        sub={invitesWaiting > 0 ? `${invitesWaiting} invite${invitesWaiting === 1 ? '' : 's'} waiting to be accepted` : 'Everyone has accepted'}
      />
      <Kpi
        href="/dashboard?status=in_progress,paused"
        label="On a job now"
        value={String(onJob.length)}
        figure="text-(--tone-sky-solid)"
        sub={onJob.length > 0 ? namesLine(onJob.map((m) => m.name)) : 'Nobody is out right now'}
      />
      <Kpi
        href="/workers"
        label="Free today"
        value={String(free.length)}
        figure={free.length > 0 ? 'text-(--tone-emerald-solid)' : 'text-(--tone-amber-solid)'}
        sub={free.length > 0 ? namesLine(free.map((m) => m.name), 3) : 'Everyone has jobs booked'}
      />
      <Kpi
        href="/dashboard"
        label="Booked today"
        value={String(booked)}
        figure="text-foreground"
        sub={booked > 0 ? `${booked === 1 ? 'job' : 'jobs'} across ${working} ${working === 1 ? 'worker' : 'workers'}` : 'Nothing booked yet'}
      />
    </div>
  );
}
