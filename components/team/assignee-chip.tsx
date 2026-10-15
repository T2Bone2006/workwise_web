'use client';

import { ChevronDown } from 'lucide-react';
import { createContext, forwardRef, useContext, useMemo, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { toneClasses, type Tone } from '@/components/look/tones';
import { personColours, type LanePerson } from '@/lib/rounds/lanes';
import { cn } from '@/lib/utils';

type Entry = { name: string; colour: Tone; isOwner: boolean };
type Value = { byId: Map<string, Entry>; owner: Entry | null; ownerId: string | null; show: boolean };

const AssigneeContext = createContext<Value | null>(null);

/**
 * Tells the calendar's cards who each visit belongs to. `show` is false when only one person has work in view (or when
 * the board is already filtered to one person): then no dot is drawn and the calendar looks as it always did.
 */
export function AssigneeProvider({ people, show, children }: { people: ReadonlyArray<LanePerson>; show: boolean; children: ReactNode }) {
  const value = useMemo<Value>(() => {
    const colours = personColours(people);
    const byId = new Map<string, Entry>(people.map((p) => [p.workerId, { name: p.isOwner ? 'You' : p.name, colour: colours.get(p.workerId) ?? 'slate', isOwner: p.isOwner }]));
    return { byId, owner: [...byId.values()].find((e) => e.isOwner) ?? null, ownerId: people.find((p) => p.isOwner)?.workerId ?? null, show };
  }, [people, show]);
  return <AssigneeContext.Provider value={value}>{children}</AssigneeContext.Provider>;
}

/** Who a visit belongs to, or null when no dot should show. An unknown or empty assignee is the owner's. */
export function useAssignee(workerId: string | null | undefined): Entry | null {
  const ctx = useContext(AssigneeContext);
  if (!ctx || !ctx.show) return null;
  return (workerId ? ctx.byId.get(workerId) : null) ?? ctx.owner;
}

/** A small coloured dot and a first name. The name is always there: colour is never the only clue. */
export function AssigneeChip({ name, colour, className }: { name: string; colour: Tone; className?: string }) {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/80', className)}>
      <span className={cn('size-2 rounded-full', toneClasses(colour).solid)} aria-hidden="true" />
      {first}
    </span>
  );
}

/** The chip for a visit, drawn only when the provider says to. */
export function VisitAssignee({ workerId, className }: { workerId: string | null | undefined; className?: string }) {
  const who = useAssignee(workerId);
  if (!who) return null;
  return <AssigneeChip name={who.name} colour={who.colour} className={className} />;
}

/** The owner's worker id, so the calendar can treat an unassigned visit as theirs. Null outside a team calendar. */
export function useOwnerId(): string | null {
  return useContext(AssigneeContext)?.ownerId ?? null;
}

/** Look a person up whether or not tags are being drawn: for headers that always name who is doing it. */
export function usePerson(workerId: string | null | undefined): (Entry & { workerId: string | null }) | null {
  const ctx = useContext(AssigneeContext);
  if (!ctx) return null;
  const found = workerId ? ctx.byId.get(workerId) : null;
  const entry = found ?? ctx.owner;
  return entry ? { ...entry, workerId: workerId ?? ctx.ownerId } : null;
}

/**
 * A card's person, drawn only when it differs from the one expected there (`expectedId`), and only when tags are on at
 * all. Where everything is as usual nothing is drawn.
 */
export function ExceptionAssignee({
  workerId,
  expectedId,
  className,
}: {
  workerId: string | null | undefined;
  expectedId: string | null | undefined;
  className?: string;
}) {
  const ctx = useContext(AssigneeContext);
  if (!ctx || !ctx.show || expectedId === undefined) return null;
  const actual = workerId ?? ctx.ownerId;
  if (actual === expectedId) return null;
  const entry = (actual ? ctx.byId.get(actual) : null) ?? ctx.owner;
  if (!entry) return null;
  return <AssigneeChip name={entry.name} colour={entry.colour} className={className} />;
}

/**
 * A person as a button: their colour, their first name, and (when it applies) a count or "+1" and a chevron. This is how
 * the calendar says "who is doing this" and how you change it, so it is the same on round headers and day headers.
 */
export const PersonChipButton = forwardRef<
  HTMLButtonElement,
  { name: string; colour: Tone; count?: number | string; chevron?: boolean; size?: 'sm' | 'md' } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>
>(function PersonChipButton({ name, colour, count, chevron = true, size = 'md', className, disabled, ...rest }, ref) {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex max-w-full items-center rounded-full font-medium text-foreground transition-colors',
        size === 'sm'
          ? 'h-5 gap-1 bg-muted px-1.5 text-[11px] hover:bg-muted/70'
          : 'h-6 gap-1.5 border border-border bg-card px-2 text-xs shadow-xs hover:bg-muted',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-100',
        className,
      )}
      {...rest}
    >
      <span className={cn('size-2 shrink-0 rounded-full', toneClasses(colour).solid)} aria-hidden="true" />
      <span className="truncate">{first}</span>
      {count !== undefined ? <span className="tabular-nums text-muted-foreground">{count}</span> : null}
      {chevron && !disabled ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
    </button>
  );
});
