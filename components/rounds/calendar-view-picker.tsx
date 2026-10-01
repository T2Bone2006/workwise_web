import Link from 'next/link';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type CalendarView = 'day' | 'week' | 'month';

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

/** The Day / Week / Month dropdown on every Calendar view. Choosing one keeps the date you were looking at. */
export function CalendarViewPicker(props: { view: CalendarView; date: string }) {
  const current = VIEWS.find((v) => v.value === props.view)?.label ?? 'Week';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          {current}
          <ChevronDown className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {VIEWS.map((view) => (
          <DropdownMenuItem key={view.value} asChild>
            <Link
              href={`/calendar?view=${view.value}&date=${props.date}`}
              className="flex items-center justify-between gap-3"
            >
              {view.label}
              {view.value === props.view ? <Check className="size-4" aria-hidden /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
