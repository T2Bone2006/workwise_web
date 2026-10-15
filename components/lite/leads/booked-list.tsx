import Link from 'next/link';
import { AddToCalendar } from '@/components/lite/leads/add-to-calendar';
import { formatPounds } from '@/components/lite/leads/lead-card';
import type { BoardLead } from '@/lib/data/lite/leads-board';
import { litePaths } from '@/lib/navigation/lite-paths';

function diaryParts(ymd: string): { weekday: string; day: string; month: string } {
  const date = new Date(`${ymd.slice(0, 10)}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(date),
    day: new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' }).format(date),
    month: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(date),
  };
}

function Row({ lead }: { lead: BoardLead }) {
  const price = typeof lead.agreedAmount === 'number' ? formatPounds(lead.agreedAmount) : null;
  const bits = [lead.bookedForTime ?? (lead.bookedForDate ? 'time to arrange' : null), lead.jobSummary, price, lead.postcode].filter(
    (bit): bit is string => bit != null && bit !== '',
  );
  const when = lead.bookedForDate ? diaryParts(lead.bookedForDate) : null;

  return (
    <li className="flex items-center gap-3 border-b border-border/60 py-3 last:border-b-0">
      <div className="w-12 shrink-0 text-center">
        {when ? (
          <>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{when.month}</p>
            <p className="text-lg font-semibold leading-none tabular-nums">{when.day}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{when.weekday}</p>
          </>
        ) : (
          <p className="text-[11px] font-medium text-muted-foreground">No date</p>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" title={lead.name}>
          {lead.name}
        </p>
        {bits.length > 0 ? <p className="text-xs text-muted-foreground">{bits.join(' · ')}</p> : null}
      </div>
      {lead.bookedForDate ? (
        <AddToCalendar lead={lead} />
      ) : (
        <Link href={litePaths.lead(lead.id)} className="shrink-0 text-sm font-medium text-primary hover:underline">
          Set the date
        </Link>
      )}
    </li>
  );
}

export function BookedList({ leads }: { leads: BoardLead[] }) {
  const dated = leads.filter((lead) => lead.bookedForDate);
  const undated = leads.filter((lead) => !lead.bookedForDate);

  return (
    <section aria-labelledby="booked-heading" className="glass-card rounded-xl p-4 sm:p-5">
      <h2 id="booked-heading" className="text-base font-semibold">
        Booked
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">Jobs you&apos;ve accepted. Add them to the calendar on your phone.</p>
      {leads.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing booked yet — accepted jobs show here.</p>
      ) : (
        <div className="mt-2">
          {dated.length > 0 ? (
            <ul>
              {dated.map((lead) => (
                <Row key={lead.id} lead={lead} />
              ))}
            </ul>
          ) : null}
          {undated.length > 0 ? (
            <div className={dated.length > 0 ? 'mt-4' : undefined}>
              <h3 className="text-xs font-medium text-muted-foreground">Not booked in yet</h3>
              <ul>
                {undated.map((lead) => (
                  <Row key={lead.id} lead={lead} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
