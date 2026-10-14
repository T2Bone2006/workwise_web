'use client';

import { useMemo, useState, type DragEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addDays, format, parseISO, subDays } from 'date-fns';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Loader2,
  Plus,
  Route,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  createOneOffVisit,
  optimiseDay,
  reorderDay,
  undoVisitChange,
} from '@/lib/actions/rounds/visits';
import { reassignVisitsAction, setUsualLeadAction } from '@/lib/actions/team-assign';
import type { OneOffCustomerOption } from '@/lib/rounds/one-off';
import type { VisitRow } from '@/lib/data/rounds/visits';
import type { SmsBrand } from '@/lib/messaging/templates';
import type { Ymd } from '@/lib/rounds/dates';
import type { VisitChangeSummary } from '@/lib/rounds/visit-changes';
import { groupHouseStops } from '@/lib/rounds/house-stops';
import { roundOfVisits, segmentByRound } from '@/lib/rounds/round-groups';
import { boardStop, roundAsStop, type BoardDay, type BoardStop } from '@/lib/rounds/week-board';
import { RoundGroup, RoundGroupMenu, RoundPersonMenu } from '@/components/rounds/round-group';
import { whoDoes } from '@/lib/rounds/who-does';
import { MoveStopDialog, type BoardChangeResult } from '@/components/rounds/week-board/move-stop-dialog';
import {
  AddressAutocompleteInput,
  unhookChromeAddressFill,
} from '@/components/ui/address-autocomplete-input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  MoveRemainingDialog,
} from '@/components/rounds/visit-actions';
import { SkipRemainingDialog } from '@/components/rounds/skip-remaining-dialog';
import { UndoChangeBar } from '@/components/rounds/undo-change-bar';
import { KeyFigure, floatingMessage } from '@/components/look';
import { AssigneeProvider, VisitAssignee } from '@/components/team/assignee-chip';
import { GiveToMenu } from '@/components/team/give-to-menu';
import { LaneHeader } from '@/components/team/lane-header';
import { useMediaQuery } from '@/components/rounds/use-stored-flag';
import { groupIntoLanes, personColours, type LanePerson } from '@/lib/rounds/lanes';
import { cn } from '@/lib/utils';
import { formatGbp } from '@/lib/money/pence';
import { summariseToday } from '@/lib/rounds/today-strip';
import { VisitStopCard } from '@/components/rounds/visit-stop-card';

function toYmd(date: Date): Ymd {
  return format(date, 'yyyy-MM-dd');
}

function isLeftover(status: string): boolean {
  return ![
    'completed',
    'cancelled',
    'declined',
    'incomplete',
  ].includes(status);
}

function repliesToReview(visits: VisitRow[]): number {
  return visits.filter((visit) => visit.customer_confirmation_status != null).length;
}

export function RoundsDayPlan({
  date,
  visits: initialVisits,
  customers,
  today,
  brand,
  undoable,
  team,
}: {
  date: Ymd;
  visits: VisitRow[];
  customers: OneOffCustomerOption[];
  today: Ymd;
  brand: SmsBrand;
  undoable: VisitChangeSummary | null;
  /**
   * The business has a lead: show a lane per person. `off` = workers off on this day; `focus` = the Person chip ('all', 'mine'
   * or a worker id). Left out, the day plan is exactly the single list it always was.
   */
  team?: { people: LanePerson[]; off: string[]; focus: string };
}) {
  const router = useRouter();
  const [order, setOrder] = useState(() => initialVisits.map((v) => v.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [optimising, setOptimising] = useState(false);
  const [lastDistanceKm, setLastDistanceKm] = useState<number | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [oneOffOpen, setOneOffOpen] = useState(false);
  const [focus, setFocus] = useState<string>(team?.focus ?? 'all');
  const [dialogScope, setDialogScope] = useState<{ workerId: string; name: string } | null>(null);
  const [dragFromLane, setDragFromLane] = useState<string | null>(null);
  const [dropLane, setDropLane] = useState<string | null>(null);
  const [confirmGive, setConfirmGive] = useState<{ ids: string[]; label: string; person: LanePerson } | null>(null);
  /** A whole round picked up by its header (to give it to another lane), and the round being moved to another day. */
  const [dragRound, setDragRound] = useState<{ ids: string[]; label: string } | null>(null);
  const [movingRound, setMovingRound] = useState<BoardStop | null>(null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const visitById = useMemo(() => {
    const map = new Map(initialVisits.map((v) => [v.id, v]));
    return map;
  }, [initialVisits]);

  const orderedVisits = useMemo(() => {
    const ids = order.filter((id) => visitById.has(id));
    const missing = initialVisits
      .map((v) => v.id)
      .filter((id) => !ids.includes(id));
    return [...ids, ...missing]
      .map((id) => visitById.get(id))
      .filter((v): v is VisitRow => v != null);
  }, [order, visitById, initialVisits]);

  const people = useMemo(() => team?.people ?? [], [team?.people]);
  const offSet = useMemo(() => new Set(team?.off ?? []), [team?.off]);
  const lanes = useMemo(() => (team ? groupIntoLanes(orderedVisits, people, offSet) : []), [team, orderedVisits, people, offSet]);
  const laneIdOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const lane of lanes) for (const v of lane.stops) map.set(v.id, lane.workerId);
    return map;
  }, [lanes]);
  const ownerId = people.find((p) => p.isOwner)?.workerId ?? null;
  const focusPerson =
    team && focus !== 'all' ? (people.find((p) => p.workerId === (focus === 'mine' ? ownerId : focus)) ?? null) : null;
  // On a phone the chips pick one person and the toolbar follows them; on a laptop every lane is on screen.
  const activeFocus = team && !isDesktop && focusPerson ? { workerId: focusPerson.workerId, name: focusPerson.isOwner ? 'You' : focusPerson.name } : null;
  const toolbarVisits = activeFocus ? (lanes.find((l) => l.workerId === activeFocus.workerId)?.stops ?? []) : orderedVisits;
  const leftovers = toolbarVisits.filter((v) => isLeftover(v.status));
  const dialogVisits = dialogScope ? (lanes.find((l) => l.workerId === dialogScope.workerId)?.stops ?? []) : orderedVisits;
  const dialogLeftovers = dialogVisits.filter((v) => isLeftover(v.status));
  const peopleWithStops = new Set(lanes.filter((l) => l.stops.length > 0).map((l) => l.workerId));
  const summary = summariseToday(orderedVisits);
  const replyCount = repliesToReview(orderedVisits);
  const dayDate = parseISO(date);
  const prev = toYmd(subDays(dayDate, 1));
  const next = toYmd(addDays(dayDate, 1));

  const orderDirty =
    order.length === initialVisits.length &&
    order.some((id, i) => id !== initialVisits[i]?.id);

  /**
   * Reorder only among the visits in the same lane as `anchorId` (the whole day when there are no lanes), keeping the
   * other lanes' places in the saved order untouched.
   */
  const applyScoped = (prevOrder: string[], anchorId: string, mutate: (groups: string[][]) => string[][] | null) => {
    const lane = laneIdOf.get(anchorId);
    const inScope = (jobId: string) => !team || laneIdOf.get(jobId) === lane;
    const scopeIds = prevOrder.filter(inScope);
    const groups = groupHouseStops(
      scopeIds.map((jobId) => visitById.get(jobId)).filter((row): row is VisitRow => row != null),
    ).map((group) => group.map((row) => row.id));
    const next = mutate(groups);
    if (!next) return prevOrder;
    const flat = next.flat();
    let k = 0;
    return prevOrder.map((jobId) => (inScope(jobId) ? (flat[k++] ?? jobId) : jobId));
  };

  const moveIndex = (id: string, delta: number) => {
    setOrder((prevOrder) =>
      applyScoped(prevOrder, id, (groups) => {
        const idx = groups.findIndex((group) => group.includes(id));
        const nextIdx = idx + delta;
        if (idx < 0 || nextIdx < 0 || nextIdx >= groups.length) return null;
        const copy = [...groups];
        const [item] = copy.splice(idx, 1);
        if (!item) return null;
        copy.splice(nextIdx, 0, item);
        return copy;
      }),
    );
  };

  const onDragStart = (id: string) => {
    setDragId(id);
    setDragFromLane(laneIdOf.get(id) ?? null);
  };
  const onDragOver = (e: DragEvent, overId: string) => {
    e.preventDefault();
    if (!dragId || dragId === overId || dragRound) return;
    // Over another lane's card: that lane's drop area handles it (giving), not a reorder.
    if (team && laneIdOf.get(dragId) !== laneIdOf.get(overId)) return;
    setOrder((prevOrder) =>
      applyScoped(prevOrder, dragId, (groups) => {
        const from = groups.findIndex((group) => group.includes(dragId));
        const to = groups.findIndex((group) => group.includes(overId));
        if (from < 0 || to < 0 || from === to) return null;
        const copy = [...groups];
        const [item] = copy.splice(from, 1);
        if (!item) return null;
        copy.splice(to, 0, item);
        return copy;
      }),
    );
  };
  const onDragEnd = () => {
    setDragRound(null);
    setDragId(null);
    setDragFromLane(null);
    setDropLane(null);
  };

  const saveOrder = async () => {
    setSavingOrder(true);
    const result = await reorderDay({ date, jobIds: order });
    setSavingOrder(false);
    if (result.success) {
      toast.success('Order saved');
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  const runOptimise = async (scope?: { workerId: string } | null) => {
    setOptimising(true);
    const result = await optimiseDay(date, scope?.workerId);
    setOptimising(false);
    if (result.success) {
      setLastDistanceKm(result.distanceKm);
      toast.success(
        `Route optimised · ${result.stops} stops · ${result.distanceKm.toFixed(1)} km`,
      );
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  const give = async (ids: string[], person: LanePerson, label: string) => {
    const result = await reassignVisitsAction({ jobIds: ids, toWorkerId: person.workerId });
    if (!result.success) {
      toast.error(result.error);
      router.refresh();
      return;
    }
    if (result.moved === 0) {
      toast.error('That visit was already done or moved, so nothing changed.');
      router.refresh();
      return;
    }
    const who = person.isOwner ? 'You' : person.name;
    const changeId = result.changeId;
    floatingMessage({
      title: `Gave ${label} to ${who}`,
      tone: 'success',
      actions: changeId
        ? [
            {
              label: 'Undo',
              onClick: async () => {
                const undone = await undoVisitChange({ changeId, notifyCustomers: false });
                if (!undone.success) toast.error(undone.error);
                router.refresh();
              },
            },
          ]
        : undefined,
    });
    router.refresh();
  };

  /** Make someone a round's usual person: its upcoming visits follow them. */
  const setUsual = async (roundId: string, roundName: string, person: LanePerson) => {
    const result = await setUsualLeadAction({ roundId, workerId: person.workerId });
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    floatingMessage({ title: `${person.isOwner ? 'You do' : `${person.name} now does`} ${roundName} every time`, tone: 'success' });
    router.refresh();
  };

  /** Giving to someone who is off asks first; everyone else is immediate. */
  const requestGive = (ids: string[], person: LanePerson, label: string) => {
    if (!person.isOwner && offSet.has(person.workerId)) setConfirmGive({ ids, label, person });
    else void give(ids, person, label);
  };

  const dropOnLane = (e: DragEvent, laneId: string) => {
    e.preventDefault();
    const from = dragFromLane;
    const draggedId = dragId;
    const wholeRound = dragRound;
    onDragEnd();
    if (!draggedId || !from || from === laneId) return;
    const person = people.find((p) => p.workerId === laneId);
    const source = lanes.find((l) => l.workerId === from);
    if (!person || !source) return;
    if (wholeRound) {
      if (wholeRound.ids.length > 0) requestGive(wholeRound.ids, person, wholeRound.label);
      return;
    }
    const group = groupHouseStops(source.stops).find((g) => g.some((v) => v.id === draggedId));
    if (!group) return;
    const ids = group.filter((v) => isLeftover(v.status)).map((v) => v.id);
    if (ids.length === 0) return;
    requestGive(ids, person, group[0]!.address.split(',')[0] ?? 'the visit');
  };

  const toolbarName = (own: string, all: string) => (team ? (activeFocus ? `${activeFocus.name === 'You' ? 'your' : `${activeFocus.name}'s`} ${own}` : `everyone's ${all}`) : null);

  /** One house-card, with its drag handle, order arrows and (with a team) who has it and a Give to… menu. */
  const renderGroups = (list: VisitRow[], compact = false) => {
    const groups = groupHouseStops(list);
    const renderHouse = (group: VisitRow[], index: number, all: VisitRow[][]) => {
      const lead = group[0]!;
      const open = group.some((visit) => isLeftover(visit.status));
      const isNext = all.findIndex((g) => g.some((visit) => isLeftover(visit.status))) === index;
      return (
        <div
          key={lead.id}
          draggable={open}
          onDragStart={() => onDragStart(lead.id)}
          onDragOver={(e) => onDragOver(e, lead.id)}
          onDragEnd={onDragEnd}
        >
          <VisitStopCard
            visit={lead}
            visits={group}
            orderIndex={index + 1}
            dimmed={group.some((visit) => dragId === visit.id)}
            isNext={isNext}
            brand={brand}
            compact={compact}
            assignee={
              team ? (
                <span className="inline-flex items-center gap-1">
                  <VisitAssignee workerId={lead.assigned_worker_id} />
                  {open ? (
                    <GiveToMenu
                      people={people}
                      currentWorkerId={laneIdOf.get(lead.id) ?? null}
                      off={offSet}
                      onGive={(person) =>
                        requestGive(
                          group.filter((v) => isLeftover(v.status)).map((v) => v.id),
                          person,
                          lead.address.split(',')[0] ?? 'the visit',
                        )
                      }
                    />
                  ) : null}
                </span>
              ) : undefined
            }
            leading={
              <div className="flex flex-col items-center gap-1 pt-0.5">
                <span className="cursor-grab text-muted-foreground active:cursor-grabbing" aria-hidden>
                  <GripVertical className="size-4" />
                </span>
                <div className="flex flex-col gap-0.5">
                  <Button type="button" variant="ghost" size="icon" className="size-6" disabled={index === 0} onClick={() => moveIndex(lead.id, -1)} aria-label="Move up">
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="size-6" disabled={index === all.length - 1} onClick={() => moveIndex(lead.id, 1)} aria-label="Move down">
                    <ArrowDown className="size-3.5" />
                  </Button>
                </div>
              </div>
            }
          />
        </div>
      );
    };

    const indexOf = new Map(groups.map((g, i) => [g, i] as const));
    const segments = segmentByRound(groups.map((group) => ({ group, round: roundOfVisits(group) })));
    return (
      <ul className="space-y-3">
        {segments.map((segment, segIndex) => {
          const houses = segment.stops.map((s) => renderHouse(s.group, indexOf.get(s.group)!, groups));
          const round = segment.round;
          if (!round) return <div key={`plain-${segIndex}`} className="space-y-3">{houses}</div>;
          const movable = segment.stops.map((s) => s.group).filter((g) => g.every((v) => isLeftover(v.status)));
          const ids = segment.stops.flatMap((s) => s.group.filter((v) => isLeftover(v.status)).map((v) => v.id));
          const firstId = segment.stops[0]!.group[0]!.id;
          const amount = segment.stops.reduce(
            (sum, s) => sum + s.group.reduce((a, v) => a + (v.status === 'cancelled' ? 0 : (v.final_amount ?? v.quoted_amount ?? 0)), 0),
            0,
          );
          const canAct = ids.length > 0 && date >= today;
          return (
            <RoundGroup
              key={`round-${round.id}-${segIndex}`}
              round={round}
              houses={segment.stops.length}
              amount={amount}
              grip={
                team && canAct ? (
                  <span
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      setDragRound({ ids, label: round.name });
                      onDragStart(firstId);
                    }}
                    onDragEnd={onDragEnd}
                    className="-ml-0.5 cursor-grab rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
                    title={`Drag ${round.name} to someone's column to give it to them`}
                    aria-hidden
                  >
                    <GripVertical className="size-3.5" />
                  </span>
                ) : undefined
              }
              who={
                team ? (() => {
                  const who = whoDoes(segment.stops.map((s) => ({ visits: s.group })), ownerId);
                  const person = people.find((x) => x.workerId === who.workerId);
                  const tone = (who.workerId ? personColours(people).get(who.workerId) : undefined) ?? 'slate';
                  return (
                    <RoundPersonMenu
                      name={person ? (person.isOwner ? 'You' : person.name) : 'You'}
                      colour={tone}
                      extra={who.others}
                      people={people}
                      currentWorkerId={who.workerId}
                      usualWorkerId={round.leadWorkerId ?? ownerId}
                      off={offSet}
                      disabled={!canAct}
                      onThisDay={(person) => requestGive(ids, person, round.name)}
                      onEveryTime={(person) => void setUsual(round.id, round.name, person)}
                    />
                  );
                })() : undefined
              }
              actions={
                canAct ? (
                  <RoundGroupMenu
                    roundName={round.name}
                    canMove={movable.length > 0}
                    onMove={() => setMovingRound(roundAsStop(movable.map((g) => boardStop(g)), round))}
                  />
                ) : undefined
              }
            >
              <div className="space-y-3">{houses}</div>
            </RoundGroup>
          );
        })}
      </ul>
    );
  };

  const list = (
    <>
      {team && !isDesktop ? (
        <div role="group" aria-label="Whose stops" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[{ key: 'all', label: 'Everyone' }, ...people.map((p) => ({ key: p.workerId, label: p.isOwner ? 'You' : p.name }))].map((chip) => {
            const on = (chip.key === 'all' && focus === 'all') || chip.key === focus || (focus === 'mine' && chip.key === ownerId);
            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={on}
                onClick={() => setFocus(chip.key)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  on ? 'border-transparent bg-(--tone-rounds-solid) text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {team && isDesktop ? (
        <div className="grid auto-cols-[minmax(300px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2">
          {lanes.map((lane) => {
            const laneSummary = summariseToday(lane.stops);
            const laneLeftovers = lane.stops.filter((v) => isLeftover(v.status)).length;
            const scope = { workerId: lane.workerId, name: lane.isOwner ? 'You' : lane.name };
            const receiving = dropLane === lane.workerId && dragFromLane !== null && dragFromLane !== lane.workerId;
            return (
              <section
                key={lane.workerId}
                aria-label={`${scope.name}'s stops`}
                onDragOver={(e) => {
                  if (!dragId || dragFromLane === lane.workerId) return;
                  e.preventDefault();
                  if (dropLane !== lane.workerId) setDropLane(lane.workerId);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null) && dropLane === lane.workerId) setDropLane(null);
                }}
                onDrop={(e) => dropOnLane(e, lane.workerId)}
                className={cn(
                  'flex min-w-0 flex-col rounded-2xl border bg-muted/30 transition-colors',
                  receiving ? 'border-(--tone-rounds-solid) bg-(--tone-rounds-soft)' : 'border-border',
                )}
              >
                <LaneHeader
                  name={lane.name}
                  isOwner={lane.isOwner}
                  colour={lane.colour}
                  stops={laneSummary.stops}
                  amount={laneSummary.plannedAmount}
                  leftovers={laneLeftovers}
                  off={lane.off}
                  busy={optimising}
                  onMove={() => {
                    setDialogScope(scope);
                    setMoveOpen(true);
                  }}
                  onSkip={() => {
                    setDialogScope(scope);
                    setSkipOpen(true);
                  }}
                  onOptimise={() => void runOptimise(scope)}
                />
                <div className="min-h-24 flex-1 p-3">
                  {lane.stops.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                      {lane.off ? `${scope.name} is off today.` : `Nothing for ${scope.name} today.`} Drag a house here to give it.
                    </p>
                  ) : (
                    renderGroups(lane.stops, true)
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        renderGroups(team ? toolbarVisits : orderedVisits)
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" className="size-8" asChild>
            <Link href={`/calendar?view=day&date=${prev}`} aria-label="Previous day">
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <h2 className="text-lg font-semibold tracking-tight">
            {format(dayDate, 'EEE d MMM yyyy')}
            {date === today ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                Today
              </span>
            ) : null}
          </h2>
          <Button variant="outline" size="icon" className="size-8" asChild>
            <Link href={`/calendar?view=day&date=${next}`} aria-label="Next day">
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {leftovers.length > 0 ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDialogScope(activeFocus);
                  setMoveOpen(true);
                }}
              >
                {team ? `Move ${toolbarName('remaining', 'remaining')}` : 'Move remaining'} ({leftovers.length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDialogScope(activeFocus);
                  setSkipOpen(true);
                }}
              >
                {team ? `Skip ${toolbarName('remaining', 'remaining')}` : 'Skip remaining'} ({leftovers.length})
              </Button>
            </>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runOptimise(activeFocus)}
            disabled={optimising || leftovers.length < 2}
          >
            {optimising ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Route className="mr-1.5 size-4" />
            )}
            {team ? `Optimise ${activeFocus ? (activeFocus.name === 'You' ? 'your' : `${activeFocus.name}'s`) : "everyone's"} route${activeFocus ? '' : 's'}` : 'Optimise'}
          </Button>
          {orderDirty ? (
            <Button size="sm" onClick={() => void saveOrder()} disabled={savingOrder}>
              {savingOrder ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : null}
              Save order
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setOneOffOpen(true)}>
            <Plus className="mr-1.5 size-4" />
            One-off
          </Button>
        </div>
      </div>

      {orderedVisits.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-(--look-card-shadow) sm:grid-cols-4">
          <KeyFigure label="Stops" value={String(summary.stops)} />
          <KeyFigure label="Planned" value={formatGbp(summary.plannedAmount)} tone="indigo" />
          <KeyFigure label="Done so far" value={`${summary.done} · ${formatGbp(summary.doneAmount)}`} tone="emerald" />
          <KeyFigure label="Still to do" value={String(summary.toGo)} tone="sky" />
        </div>
      ) : null}

      {lastDistanceKm != null ? (
        <p className="text-sm text-muted-foreground">
          Last optimise: {lastDistanceKm.toFixed(1)} km
        </p>
      ) : null}

      {replyCount > 0 ? (
        <Link
          href="/messages"
          className="block rounded-xl border border-(--tone-sky-line) bg-(--tone-sky-soft) px-4 py-3 text-sm font-semibold text-foreground"
        >
          {replyCount} {replyCount === 1 ? 'reply' : 'replies'} about this day to review
        </Link>
      ) : null}

      <UndoChangeBar change={undoable} brand={brand} />

      {orderedVisits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">No visits this day</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a one-off job, or pick another day from the month view.
          </p>
        </div>
      ) : team ? (
        <AssigneeProvider people={people} show={peopleWithStops.size > 1}>
          {list}
        </AssigneeProvider>
      ) : (
        list
      )}

      <MoveRemainingDialog
        fromDate={date}
        leftoverCount={dialogLeftovers.length}
        brand={brand}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        scope={dialogScope ?? undefined}
      />
      <SkipRemainingDialog
        open={skipOpen}
        onOpenChange={setSkipOpen}
        date={date}
        remainingCount={dialogLeftovers.length}
        brand={brand}
        scope={dialogScope ?? undefined}
      />

      <Dialog open={confirmGive !== null} onOpenChange={(open) => !open && setConfirmGive(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirmGive?.person.name} is off that day</DialogTitle>
            <DialogDescription>Give {confirmGive?.label} to them anyway?</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConfirmGive(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const pending = confirmGive;
                setConfirmGive(null);
                if (pending) void give(pending.ids, pending.person, pending.label);
              }}
            >
              Give anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MoveStopDialog
        stop={movingRound}
        fromDate={date}
        today={today}
        brand={brand}
        open={movingRound !== null}
        resolveDay={(d): BoardDay => ({
          date: d,
          weekday: 1,
          stops: [],
          total: 0,
          done: 0,
          plannedAmount: 0,
          isToday: false,
          isPast: false,
          isDayOff: false,
        })}
        onOpenChange={(open) => !open && setMovingRound(null)}
        onFinished={(result: BoardChangeResult | null) => {
          setMovingRound(null);
          if (result) {
            const changeId = result.changeId;
            floatingMessage({
              title: result.text,
              tone: 'success',
              actions: changeId
                ? [
                    {
                      label: 'Undo',
                      onClick: async () => {
                        const undone = await undoVisitChange({ changeId, notifyCustomers: false });
                        if (!undone.success) toast.error(undone.error);
                        router.refresh();
                      },
                    },
                  ]
                : undefined,
            });
          }
          router.refresh();
        }}
      />

      <OneOffVisitDialog
        open={oneOffOpen}
        onOpenChange={setOneOffOpen}
        date={date}
        customers={customers}
      />
    </div>
  );
}

function OneOffVisitDialog({
  open,
  onOpenChange,
  date,
  customers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Ymd;
  customers: OneOffCustomerOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [title, setTitle] = useState('One-off visit');
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('30');
  const [time, setTime] = useState('');
  const [accessNotes, setAccessNotes] = useState('');

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: c.address ? `${c.name} · ${c.address}` : c.name,
      })),
    [customers],
  );

  /** Picking a customer fills in their address; the trader can still change it. */
  const pickCustomer = (id: string) => {
    setCustomerId(id);
    const picked = customers.find((c) => c.id === id);
    if (!picked) return;
    setAddress(picked.address ?? '');
    setPostcode(picked.postcode ?? '');
    setAccessNotes(picked.accessNotes ?? '');
  };

  const reset = () => {
    setCustomerId('');
    setTitle('One-off visit');
    setAddress('');
    setPostcode('');
    setPrice('');
    setDuration('30');
    setTime('');
    setAccessNotes('');
  };

  const handle = async () => {
    setPending(true);
    const result = await createOneOffVisit({
      customer_id: customerId,
      title,
      address,
      postcode,
      price: Number(price),
      duration_minutes: Number(duration),
      access_notes: accessNotes,
      scheduled_date: date,
      scheduled_time: time || '',
    });
    setPending(false);
    if (result.success) {
      toast.success('One-off visit added');
      onOpenChange(false);
      reset();
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add one-off job</DialogTitle>
          <DialogDescription>
            A single visit on {format(parseISO(date), 'EEE d MMM yyyy')} — not
            tied to a repeating agreement.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <SearchableSelect
              options={customerOptions}
              value={customerId}
              onValueChange={pickCustomer}
              placeholder="Select customer"
              searchPlaceholder={unhookChromeAddressFill('Search name or street…')}
              emptyText="No customer found."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{unhookChromeAddressFill('Address')}</Label>
            <AddressAutocompleteInput
              value={address}
              onValueChange={setAddress}
              onAddressSelect={({ address: a, postcode: p }) => {
                setAddress(a);
                if (p) setPostcode(p);
              }}
              placeholder="Start typing a postcode or address…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{unhookChromeAddressFill('Postcode')}</Label>
            <Input
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              name="outward"
              autoComplete="off"
              placeholder={unhookChromeAddressFill('Filled in when you pick an address')}
              className="uppercase"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Price (£)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Minutes</Label>
              <Input
                type="number"
                min={5}
                max={600}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Access notes</Label>
            <Input
              value={accessNotes}
              onChange={(e) => setAccessNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handle()}
            disabled={pending || !customerId || !address || !postcode || price === ''}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Add visit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
