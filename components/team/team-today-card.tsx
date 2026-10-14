import Link from 'next/link';
import { CalendarOff } from 'lucide-react';
import { IconChip } from '@/components/look';
import { SectionCard, formatShortDate } from '@/components/rounds/overview/shared';
import type { TeamToday } from '@/lib/data/rounds/team-today-core';
import { formatGbp } from '@/lib/money/pence';
import { PersonProgressRow } from './person-progress-row';

/** The Dashboard's Team today card: who's off, how far through each person is, and what they're holding. */
export function TeamTodayCard({ team }: { team: TeamToday }) {
  const week = team.weekDays.filter((d) => d.days > 0);
  return (
    <SectionCard
      title="Team today"
      labelledBy="team-today-title"
      action={{ href: '/team', label: 'Team' }}
      aside={
        team.holdingTotal > 0 ? (
          <Link href="/team/cash" className="rounded-lg px-2 py-1 text-sm font-medium text-(--tone-rose-text) hover:bg-(--tone-rose-soft) focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {formatGbp(team.holdingTotal)} to hand in
          </Link>
        ) : null
      }
    >
      {team.out.length > 0 ? (
        <div className="flex items-start gap-3 rounded-xl bg-(--tone-amber-soft) px-3 py-2.5 text-sm text-(--tone-amber-text)">
          <IconChip icon={CalendarOff} tone="amber" size="sm" />
          <p className="min-w-0 pt-0.5">
            {team.out.map((o, i) => (
              <span key={o.name}>
                {i > 0 ? ' · ' : ''}
                <span className="font-medium">{o.name}</span> {o.name === 'You' ? 'are' : 'is'} off until {formatShortDate(o.until)}
              </span>
            ))}
          </p>
        </div>
      ) : null}

      {team.people.length > 0 ? (
        <ul className="divide-y divide-border">
          {team.people.map((p) => (
            <PersonProgressRow key={p.workerId ?? p.name} person={p} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nobody has visits today.</p>
      )}

      {week.length > 0 ? (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          This week: {week.map((d) => `${d.name} ${d.days} ${d.days === 1 ? 'day' : 'days'}`).join(' · ')}.{' '}
          <Link href="/team/pay" className="font-medium text-primary hover:underline">
            Pay
          </Link>
        </p>
      ) : null}
    </SectionCard>
  );
}
