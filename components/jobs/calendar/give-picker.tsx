'use client';

import { useMemo, useState } from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Check } from 'lucide-react';
import { Avatar } from '@/components/look';
import type { Tone } from '@/components/look/tones';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { giveChoices, jobsByPerson, type CalendarWorker, type GiveChoice, type ProCalendarJob } from '@/lib/jobs/pro-calendar';
import type { Ymd } from '@/lib/rounds/dates';
import { formatBoardDay } from '@/lib/rounds/week-board';
import { cn } from '@/lib/utils';

/** Someone asked to give jobs out: which, what to call them, who has them now and which day they are on. */
export type GiveRequest = { ids: string[]; what: string; currentId: string | null; date: Ymd | null };

export type AskGive = (request: GiveRequest) => void;

function Choice(props: { choice: GiveChoice; colour: Tone; current: boolean; note: string; onPick: () => void }) {
  const { worker } = props.choice;
  return (
    <CommandPrimitive.Item
      value={worker.id}
      disabled={props.current}
      onSelect={props.onPick}
      className="flex cursor-default items-center gap-3 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:opacity-60 data-[selected=true]:bg-accent"
    >
      <Avatar name={worker.name} tone={props.colour} size="sm" />
      <span className="min-w-0 flex-1 truncate font-medium">{worker.name}</span>
      {props.current ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="size-3.5" aria-hidden />
          Has it
        </span>
      ) : (
        <span className="text-xs tabular-nums text-muted-foreground">{props.note}</span>
      )}
    </CommandPrimitive.Item>
  );
}

const HEADING = '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground';

/**
 * Pick who gets the work. Built for a big team: type part of a name, and the people already working that day come
 * first with the fewest jobs at the top (they're out and have room), then everyone who is free that day.
 */
export function GivePicker(props: {
  request: GiveRequest | null;
  workers: ReadonlyArray<CalendarWorker>;
  jobs: ReadonlyArray<ProCalendarJob>;
  colours: ReadonlyMap<string, Tone>;
  onClose: () => void;
  onGive: (ids: string[], worker: CalendarWorker) => void;
}) {
  const [query, setQuery] = useState('');
  const { request } = props;
  const day = request?.date ?? null;
  const load = useMemo(() => (day ? jobsByPerson(props.jobs.filter((job) => job.date === day)) : new Map<string, number>()), [props.jobs, day]);
  const { working, free } = giveChoices(props.workers, load, query);
  const n = request?.ids.length ?? 0;
  const pick = (worker: CalendarWorker) => {
    if (!request) return;
    props.onClose();
    props.onGive(request.ids, worker);
  };
  const choice = (item: GiveChoice, note: string) => (
    <Choice
      key={item.worker.id}
      choice={item}
      colour={props.colours.get(item.worker.id) ?? 'slate'}
      current={item.worker.id === request?.currentId}
      note={note}
      onPick={() => pick(item.worker)}
    />
  );

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          setQuery('');
          props.onClose();
        }
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-5 pt-5 pb-3 text-left">
          <DialogTitle className="truncate pr-6">Give {n > 1 ? `${n} jobs` : request?.what || 'the job'} to</DialogTitle>
          <DialogDescription>
            {day ? `${formatBoardDay(day)}. People already working that day come first, fewest jobs at the top.` : 'Pick someone. The job keeps no date until you put it on a day.'}
          </DialogDescription>
        </DialogHeader>
        <CommandPrimitive shouldFilter={false} className="flex flex-col">
          <CommandPrimitive.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={`Find a person (${props.workers.length})`}
            className="h-11 w-full border-b border-border bg-transparent px-5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <CommandPrimitive.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
            <CommandPrimitive.Empty className="py-8 text-center text-sm text-muted-foreground">No one by that name.</CommandPrimitive.Empty>
            {working.length > 0 ? (
              <CommandPrimitive.Group heading={`Working ${day ? formatBoardDay(day) : ''} (${working.length})`} className={HEADING}>
                {working.map((item) => choice(item, `${item.count} ${item.count === 1 ? 'job' : 'jobs'}`))}
              </CommandPrimitive.Group>
            ) : null}
            {free.length > 0 ? (
              <CommandPrimitive.Group heading={day ? `Free that day (${free.length})` : `Everyone (${free.length})`} className={cn(HEADING)}>
                {free.map((item) => choice(item, day ? 'Free' : ''))}
              </CommandPrimitive.Group>
            ) : null}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}
