import Link from 'next/link';
import { ArrowUpRight, CalendarDays, Phone, X } from 'lucide-react';
import { Avatar, Tag } from '@/components/look';
import { RoundChip } from '@/components/rounds/round-chip';
import { Button } from '@/components/ui/button';
import { formatGbp } from '@/lib/money/pence';
import type { MapPlace } from '@/lib/rounds/map-areas';
import type { RoundRow } from '@/lib/rounds/rounds';

const WEEKDAY_DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function when(ymd: string): string {
  return WEEKDAY_DAY_MONTH.format(new Date(`${ymd.slice(0, 10)}T12:00:00Z`));
}

/** One customer, shown in the side panel when you tap their pin. */
export function MapPlaceCard({ place, round, onClose }: { place: MapPlace; round: RoundRow | null; onClose: () => void }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow)" aria-label={place.customerName}>
      <div className="flex items-start gap-3">
        <Avatar name={place.customerName} tone="rounds" size="md" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold leading-tight">{place.customerName}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {place.address}
            {place.postcode ? `, ${place.postcode}` : ''}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close customer">
          <X className="size-4" />
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {place.owes ? <Tag tone="rose">Owes money</Tag> : null}
        {place.dueThisWeek ? <Tag tone="amber">Due this week</Tag> : null}
        {!place.owes && !place.dueThisWeek ? <Tag tone="emerald">All fine</Tag> : null}
        {round ? <RoundChip round={round} /> : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-muted/60 px-3 py-2">
          <p className="truncate text-[11px] text-muted-foreground">
            {place.title}
            {place.frequencyLabel ? `, ${place.frequencyLabel.toLowerCase()}` : ''}
          </p>
          <p className="text-[15px] font-semibold tabular-nums">{formatGbp(place.price)} a visit</p>
        </div>
        <div className="rounded-xl bg-muted/60 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Worth a year</p>
          <p className="text-[15px] font-semibold tabular-nums text-(--tone-emerald-solid)">{formatGbp(Math.round(place.yearly))}</p>
        </div>
      </div>

      <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
        {place.nextVisit ? `Next visit ${when(place.nextVisit)}` : 'No visit booked yet'}
      </p>
      {place.owed > 0 ? (
        <p className="mt-1.5 text-sm font-medium text-(--tone-rose-solid)">Owes {formatGbp(place.owed)}</p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button asChild className="flex-1 text-primary-foreground!">
          <Link href={`/customers/${place.customerId}`}>
            Open customer
            <ArrowUpRight className="size-4" />
          </Link>
        </Button>
        {place.phone ? (
          <Button asChild variant="outline" size="icon" className="text-foreground!" aria-label={`Call ${place.customerName}`}>
            <a href={`tel:${place.phone.replace(/\s+/g, '')}`}>
              <Phone className="size-4" />
            </a>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** Several places on top of each other (the same building, or too close to split at full zoom). */
export function MapPlaceList({
  places,
  onPick,
  onClose,
}: {
  places: MapPlace[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow)">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{places.length} places here</h2>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close list">
          <X className="size-4" />
        </Button>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {places.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p.id)}
              className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:text-primary"
            >
              <Avatar name={p.customerName} tone="rounds" size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.customerName}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.address}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
