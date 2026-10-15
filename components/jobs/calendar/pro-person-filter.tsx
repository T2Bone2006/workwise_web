'use client';

import { useRouter } from 'next/navigation';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { CalendarWorker, PersonFilter, ProCalendarView } from '@/lib/jobs/pro-calendar';
import { calendarHref } from './calendar-view-picker';

/**
 * "Whose jobs am I looking at": everyone, the jobs no one has yet, or one worker. Lives in the URL (?person=) so a
 * link or a refresh keeps it. Type to find someone, so it works for a team of any size.
 */
export function ProPersonFilter(props: {
  view: ProCalendarView;
  date: string;
  value: PersonFilter;
  workers: ReadonlyArray<CalendarWorker>;
}) {
  const router = useRouter();
  const options = [
    { value: 'all', label: 'Everyone' },
    { value: 'none', label: 'No one yet' },
    ...props.workers.map((worker) => ({ value: worker.id, label: worker.name, group: `People (${props.workers.length})` })),
  ];
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Person</span>
      <SearchableSelect
        options={options}
        value={props.value}
        onValueChange={(value) => router.push(calendarHref(props.view, props.date, value))}
        searchPlaceholder="Find a person"
        emptyText="No one by that name."
        className="h-9 w-52 rounded-full bg-card font-medium"
      />
    </label>
  );
}
