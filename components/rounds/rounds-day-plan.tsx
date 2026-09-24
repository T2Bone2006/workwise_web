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
} from '@/lib/actions/rounds/visits';
import type { CustomerRow } from '@/lib/data/customers';
import type { VisitRow } from '@/lib/data/rounds/visits';
import type { Ymd } from '@/lib/rounds/dates';
import { AddressAutocompleteInput } from '@/components/ui/address-autocomplete-input';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MoveRemainingDialog,
} from '@/components/rounds/visit-actions';
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

export function RoundsDayPlan({
  date,
  visits: initialVisits,
  customers,
  today,
}: {
  date: Ymd;
  visits: VisitRow[];
  customers: CustomerRow[];
  today: Ymd;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(() => initialVisits.map((v) => v.id));
  const [dragId, setDragId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [optimising, setOptimising] = useState(false);
  const [lastDistanceKm, setLastDistanceKm] = useState<number | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [oneOffOpen, setOneOffOpen] = useState(false);

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

  const leftovers = orderedVisits.filter((v) => isLeftover(v.status));
  const dayDate = parseISO(date);
  const prev = toYmd(subDays(dayDate, 1));
  const next = toYmd(addDays(dayDate, 1));

  const orderDirty =
    order.length === initialVisits.length &&
    order.some((id, i) => id !== initialVisits[i]?.id);

  const moveIndex = (id: string, delta: number) => {
    setOrder((prev) => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const onDragStart = (id: string) => setDragId(id);
  const onDragOver = (e: DragEvent, overId: string) => {
    e.preventDefault();
    if (!dragId || dragId === overId) return;
    setOrder((prev) => {
      const from = prev.indexOf(dragId);
      const to = prev.indexOf(overId);
      if (from < 0 || to < 0) return prev;
      const copy = [...prev];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
  };
  const onDragEnd = () => setDragId(null);

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

  const runOptimise = async () => {
    setOptimising(true);
    const result = await optimiseDay(date);
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
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/calendar?view=month&date=${date}`}>Month</Link>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {leftovers.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)}>
              Move remaining ({leftovers.length})
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runOptimise()}
            disabled={optimising || leftovers.length < 2}
          >
            {optimising ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Route className="mr-1.5 size-4" />
            )}
            Optimise
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

      {lastDistanceKm != null ? (
        <p className="text-sm text-muted-foreground">
          Last optimise: {lastDistanceKm.toFixed(1)} km
        </p>
      ) : null}

      {orderedVisits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">No visits this day</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a one-off job, or pick another day from the month view.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {orderedVisits.map((visit, index) => (
            <div
              key={visit.id}
              draggable={isLeftover(visit.status)}
              onDragStart={() => onDragStart(visit.id)}
              onDragOver={(e) => onDragOver(e, visit.id)}
              onDragEnd={onDragEnd}
            >
              <VisitStopCard
                visit={visit}
                orderIndex={index + 1}
                dimmed={dragId === visit.id}
                leading={
                  <div className="flex flex-col items-center gap-1 pt-0.5">
                    <span
                      className="cursor-grab text-muted-foreground active:cursor-grabbing"
                      aria-hidden
                    >
                      <GripVertical className="size-4" />
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        disabled={index === 0}
                        onClick={() => moveIndex(visit.id, -1)}
                        aria-label="Move up"
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        disabled={index === orderedVisits.length - 1}
                        onClick={() => moveIndex(visit.id, 1)}
                        aria-label="Move down"
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                }
              />
            </div>
          ))}
        </ul>
      )}

      <MoveRemainingDialog
        fromDate={date}
        leftoverCount={leftovers.length}
        open={moveOpen}
        onOpenChange={setMoveOpen}
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
  customers: CustomerRow[];
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
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select customer" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Postcode</Label>
            <AddressAutocompleteInput
              value={postcode}
              onValueChange={setPostcode}
              onAddressSelect={({ address: a, postcode: p }) => {
                if (p) setPostcode(p);
                setAddress(a);
              }}
              placeholder="Start typing…"
              className="uppercase"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
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
