import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { LookCard, Tag } from '@/components/look';
import { formatGbp } from '@/lib/money/pence';
import { friendlyTime } from '@/lib/rounds/today-strip';

export type NextVisit = {
  id: string;
  date: string;
  time: string | null;
  title: string;
  amount: number | null;
  /** From the schedule, not booked into the calendar yet. */
  planned: boolean;
};

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function dayLabel(ymd: string): string {
  return dayFormat.format(new Date(`${ymd.slice(0, 10)}T12:00:00Z`)).replace(',', '');
}

/** The next few visits for this customer, soonest first, with what's being done and what it's worth. */
export function NextVisitsCard({
  customerId,
  visits,
  today,
}: {
  customerId: string;
  visits: NextVisit[];
  today: string;
}) {
  return (
    <LookCard
      title="Next visits"
      icon={CalendarDays}
      tone="sky"
      aside={
        visits.length > 0 ? (
          <a href="#visits" className="text-sm font-medium text-primary hover:underline">
            See all visits
          </a>
        ) : null
      }
    >
      {visits.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No visit booked yet.{' '}
          <Link href={`/customers/${customerId}/agreements/new`} className="font-medium text-primary hover:underline">
            Add a service
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visits.map((visit) => {
            const overdue = visit.date < today;
            const time = friendlyTime(visit.time);
            return (
              <li key={visit.id} className="flex items-center gap-3 rounded-xl bg-muted/60 px-3.5 py-2.5">
                <Tag tone={overdue ? 'amber' : 'sky'} className="w-[6.5rem] shrink-0 justify-center">
                  {overdue ? `Was ${dayLabel(visit.date)}` : dayLabel(visit.date)}
                </Tag>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{visit.title}</span>
                  {time || visit.planned ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {[time, visit.planned ? 'From the schedule' : null].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {visit.amount != null ? formatGbp(visit.amount) : '—'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </LookCard>
  );
}
