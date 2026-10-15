'use client';

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import { LeadCard } from '@/components/lite/leads/lead-card';
import { WonWhenDialog } from '@/components/lite/leads/won-when-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { setLeadStatusAction } from '@/lib/actions/lite/leads';
import type { BoardLead, LeadsBoardData } from '@/lib/data/lite/leads-board';
import { cn } from '@/lib/utils';

type Status = BoardLead['status'];

const NO_OVERRIDES: Partial<Record<string, Status>> = {};

const COLUMNS: { id: Status; label: string; dot: string; top: string; older: boolean }[] = [
  { id: 'new', label: 'New', dot: 'bg-(--tone-rounds-solid)', top: 'border-t-(--tone-rounds-solid)', older: false },
  { id: 'contacted', label: 'Contacted', dot: 'bg-(--tone-indigo-solid)', top: 'border-t-(--tone-indigo-solid)', older: false },
  { id: 'won', label: 'Won', dot: 'bg-(--tone-emerald-solid)', top: 'border-t-(--tone-emerald-solid)', older: true },
  { id: 'lost', label: 'Lost', dot: 'bg-(--tone-slate-solid)', top: 'border-t-(--tone-slate-solid)', older: true },
];

function MoveMenu({
  lead,
  pending,
  onMove,
}: {
  lead: BoardLead;
  pending: boolean;
  onMove: (lead: BoardLead, status: Status) => void;
}) {
  const trigger = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0"
      disabled={pending}
      aria-label={`Move ${lead.name}`}
    >
      Move to…
    </Button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {COLUMNS.filter((column) => column.id !== lead.status).map((column) => (
          <DropdownMenuItem key={column.id} onSelect={() => onMove(lead, column.id)}>
            Move to {column.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Where a card sits once a column is sorted newest first. */
function insertIndex(leads: BoardLead[], moving: BoardLead): number {
  const index = leads.findIndex((lead) => lead.createdAt < moving.createdAt);
  return index === -1 ? leads.length : index;
}

/** The column under a point, using the same on-screen check as the rounds calendar. */
function columnAt(x: number, y: number): Status | null {
  const section = document
    .elementsFromPoint(x, y)
    .map((el) => el.closest('section[aria-label]'))
    .find((el): el is HTMLElement => el instanceof HTMLElement);
  const label = section?.getAttribute('aria-label');
  return COLUMNS.find((column) => column.label === label)?.id ?? null;
}

/** The dashed space the rounds calendar uses: where a card was, or where it will land. */
function DropSlot({ height, kind }: { height: number; kind: 'gap' | 'origin' }) {
  return (
    <div
      aria-hidden
      data-board-placeholder={kind}
      style={{ height }}
      className="shrink-0 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5"
    />
  );
}

function DraggableCard({ lead, pending }: { lead: BoardLead; pending: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    disabled: pending,
    data: { status: lead.status },
  });
  return (
    <LeadCard
      lead={lead}
      locked={false}
      dragging={isDragging}
      handleRef={setNodeRef}
      handleProps={{ ...attributes, ...listeners }}
    />
  );
}

function ColumnBody({
  column,
  leads,
  pendingId,
  onMove,
  draggable,
  dropRef,
  landing,
  liftedId,
  gapHeight,
  hideHeader,
}: {
  column: (typeof COLUMNS)[number];
  leads: BoardLead[];
  pendingId: string | null;
  onMove: (lead: BoardLead, status: Status) => void;
  draggable: boolean;
  dropRef?: (node: HTMLElement | null) => void;
  /** This column is where the card in the air will land. */
  landing?: BoardLead | null;
  /** The card that was picked up from this column. */
  liftedId?: string | null;
  gapHeight?: number;
  hideHeader?: boolean;
}) {
  const at = landing ? insertIndex(leads, landing) : -1;
  const rows: ReactNode[] = [];
  if (leads.length === 0 && !landing) {
    rows.push(
      <p key="empty" className="px-0.5 py-6 text-center text-sm text-muted-foreground">
        Nothing here yet
      </p>,
    );
  }
  leads.forEach((lead, index) => {
    if (index === at && gapHeight) rows.push(<DropSlot key="gap" height={gapHeight} kind="gap" />);
    const lifted = lead.id === liftedId;
    rows.push(
      <div key={lead.id} className={lifted ? 'hidden' : undefined}>
        {draggable ? (
          <DraggableCard lead={lead} pending={pendingId === lead.id} />
        ) : (
          <LeadCard
            lead={lead}
            locked={lead.bookingStatus === 'requested'}
            menu={<MoveMenu lead={lead} pending={pendingId === lead.id} onMove={onMove} />}
          />
        )}
      </div>,
    );
    if (lifted && gapHeight) rows.push(<DropSlot key="origin" height={gapHeight} kind="origin" />);
  });
  if (at === leads.length && gapHeight) rows.push(<DropSlot key="gap" height={gapHeight} kind="gap" />);

  return (
    <section
      ref={dropRef}
      aria-label={column.label}
      className={cn(
        'flex min-w-0 flex-col rounded-2xl border-t-[3px] bg-muted/60 p-3 ring-1 ring-border/60',
        column.top,
        landing && 'bg-(--tone-rounds-soft) ring-primary/40',
      )}
    >
      {hideHeader ? null : (
      <header className="mb-2.5 flex items-center gap-2 px-0.5">
        <span className={cn('size-2 shrink-0 rounded-full', column.dot)} aria-hidden="true" />
        <h3 className="text-sm font-semibold">{column.label}</h3>
        <span className="rounded-full bg-card px-1.5 py-px text-xs font-medium tabular-nums text-muted-foreground ring-1 ring-border">
          {leads.length}
        </span>
      </header>
      )}
      <div className="flex max-h-[32rem] flex-1 flex-col gap-2 overflow-y-auto">{rows}</div>
    </section>
  );
}

function DropColumn(props: {
  column: (typeof COLUMNS)[number];
  leads: BoardLead[];
  pendingId: string | null;
  onMove: (lead: BoardLead, status: Status) => void;
  landing: BoardLead | null;
  liftedId: string | null;
  gapHeight: number;
}) {
  const { setNodeRef } = useDroppable({ id: props.column.id });
  return <ColumnBody {...props} draggable dropRef={setNodeRef} />;
}

export function LeadsBoard({ columns }: { columns: LeadsBoardData['columns'] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Status>('new');
  const [draft, setDraft] = useState<{
    columns: LeadsBoardData['columns'];
    overrides: Partial<Record<string, Status>>;
  } | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<Status | null>(null);
  const [gapHeight, setGapHeight] = useState(0);
  const [overlayWidth, setOverlayWidth] = useState(0);
  const [wonLead, setWonLead] = useState<BoardLead | null>(null);
  const overRef = useRef<Status | null>(null);
  const startRef = useRef({ left: 0, top: 0, width: 0, height: 0 });
  const overlayRef = useRef<HTMLDivElement | null>(null);

  function placeOverlay(left: number, top: number) {
    const el = overlayRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }
  const overrides = draft?.columns === columns ? draft.overrides : NO_OVERRIDES;

  const initial = useMemo(
    () => [...columns.new, ...columns.contacted, ...columns.won, ...columns.lost],
    [columns],
  );

  const placed = useMemo(() => {
    const next: LeadsBoardData['columns'] = { new: [], contacted: [], won: [], lost: [] };
    for (const lead of initial) {
      const status = overrides[lead.id] ?? lead.status;
      next[status].push(status === lead.status ? lead : { ...lead, status });
    }
    return next;
  }, [initial, overrides]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const active = activeId ? (initial.find((lead) => lead.id === activeId) ?? null) : null;

  async function move(lead: BoardLead, status: Status) {
    if (lead.bookingStatus === 'requested' || lead.status === status || pendingId) return;
    if (status === 'won') {
      setWonLead(lead);
      return;
    }
    const nextOverrides = { ...overrides, [lead.id]: status };
    setDraft({ columns, overrides: nextOverrides });
    setPendingId(lead.id);
    const result = await setLeadStatusAction(lead.id, status);
    setPendingId(null);
    if (!result.success) {
      const rolled = { ...nextOverrides };
      delete rolled[lead.id];
      setDraft({ columns, overrides: rolled });
      toast(result.error);
      return;
    }
    router.refresh();
  }

  function onDragStart(event: DragStartEvent) {
    const target = event.activatorEvent?.target;
    const article = target instanceof Element ? target.closest('article') : null;
    const box = article?.getBoundingClientRect();
    const initial = event.active.rect.current.initial;
    startRef.current = {
      left: box?.left ?? initial?.left ?? 0,
      top: box?.top ?? initial?.top ?? 0,
      width: box?.width ?? initial?.width ?? 0,
      height: box?.height || initial?.height || 72,
    };
    setActiveId(String(event.active.id));
    overRef.current = null;
    setOverId(null);
    setGapHeight(startRef.current.height);
    setOverlayWidth(startRef.current.width);
    placeOverlay(startRef.current.left, startRef.current.top);
  }

  function onDragMove(event: DragMoveEvent) {
    const start = startRef.current;
    placeOverlay(start.left + event.delta.x, start.top + event.delta.y);
    const next = columnAt(start.left + event.delta.x + start.width / 2, start.top + event.delta.y + start.height / 2);
    if (overRef.current === next) return;
    overRef.current = next;
    setOverId(next);
  }

  function clearDrag() {
    overRef.current = null;
    setActiveId(null);
    setOverId(null);
    setGapHeight(0);
  }

  function onDragEnd(event: DragEndEvent) {
    const start = startRef.current;
    const next = columnAt(start.left + event.delta.x + start.width / 2, start.top + event.delta.y + start.height / 2);
    clearDrag();
    if (!next) return;
    const lead = placed.new
      .concat(placed.contacted, placed.won, placed.lost)
      .find((item) => item.id === String(event.active.id));
    if (!lead) return;
    void move(lead, next);
  }

  const phone = COLUMNS.find((column) => column.id === tab) ?? COLUMNS[0];
  const total = COLUMNS.reduce((sum, column) => sum + placed[column.id].length, 0);

  useLayoutEffect(() => {
    if (!active) return;
    placeOverlay(startRef.current.left, startRef.current.top);
  }, [active]);

  return (
    <section aria-labelledby="enquiries-heading">
      <h2 id="enquiries-heading" className="text-base font-semibold">
        Every enquiry
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        New ones you haven&apos;t spoken to, then Contacted, Won and Lost.
      </p>
      <div className="mt-4 md:hidden">
        <div className="flex border-b border-border/70">
          {COLUMNS.map((column) => (
            <button
              key={column.id}
              type="button"
              aria-pressed={tab === column.id}
              onClick={() => setTab(column.id)}
              className={cn(
                'min-w-0 flex-1 border-b-2 px-1 py-2 text-center text-xs',
                tab === column.id ? 'border-foreground font-semibold' : 'border-transparent text-muted-foreground',
              )}
            >
              <span className="block truncate">{column.label}</span>
              <span className="tabular-nums">{placed[column.id].length}</span>
            </button>
          ))}
        </div>
        <div className="mt-3">
          <ColumnBody column={phone} leads={placed[phone.id]} pendingId={pendingId} onMove={move} draggable={false} hideHeader />
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={clearDrag}
      >
        <div className="mt-4 hidden md:grid md:grid-cols-4 md:gap-4">
          {COLUMNS.map((column) => (
            <DropColumn
              key={column.id}
              column={column}
              leads={placed[column.id]}
              pendingId={pendingId}
              onMove={move}
              landing={active && overId === column.id && active.status !== column.id ? active : null}
              liftedId={active?.status === column.id ? active.id : null}
              gapHeight={gapHeight}
            />
          ))}
        </div>
      </DndContext>
      {active && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={overlayRef}
              className="pointer-events-none fixed top-0 left-0 z-50"
              style={{ width: overlayWidth || undefined }}
            >
              <LeadCard lead={active} className="shadow-lg" />
            </div>,
            document.body,
          )
        : null}
      {wonLead ? (
        <WonWhenDialog open onOpenChange={(open) => { if (!open) setWonLead(null); }} lead={wonLead} intent="mark" />
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        {total === 0
          ? 'Enquiries show here once someone uses the chat on your website.'
          : "Won and Lost show the last 60 days. Older leads are on each lead's page."}
      </p>
    </section>
  );
}
