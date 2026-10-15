'use client';

import { CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { googleCalendarUrl, leadCalendarEvent } from '@/lib/lite/calendar';
import type { BoardLead } from '@/lib/data/lite/leads-board';

export function AddToCalendar({ lead }: { lead: BoardLead }) {
  const event = leadCalendarEvent(lead);
  if (!event) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="shrink-0">
          <CalendarPlus />
          Add to my calendar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
            Google Calendar
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`/api/lite/leads/${lead.id}/ics`}>Apple / Outlook (download)</a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
