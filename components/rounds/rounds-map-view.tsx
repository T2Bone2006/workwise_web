'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronUp, MapPinOff, Pencil, Plus, PoundSterling, Users, Wallet } from 'lucide-react';
import { StatTile, toneClasses, type Tone } from '@/components/look';
import { RoundEditor } from '@/components/rounds/round-editor';
import { useMediaQuery, useStoredFlag } from '@/components/rounds/use-stored-flag';
import { Button } from '@/components/ui/button';
import { deleteRound, saveRound } from '@/lib/actions/rounds/rounds';
import { setUsualLeadAction } from '@/lib/actions/team-assign';
import { floatingMessage } from '@/components/look';
import { formatGbp } from '@/lib/money/pence';
import {
  PIN_COLOURS,
  placesInBounds,
  summarisePlaces,
  type HeatMode,
  type LatLng,
  type MapBounds,
  type MapPlace,
} from '@/lib/rounds/map-areas';
import { RAMP_CSS } from '@/lib/rounds/map-heat';
import {
  cleanRoundName,
  movingFromOtherRounds,
  nextRoundColour,
  placesInShape,
  roundNameTaken,
  summariseRounds,
  type RoundDraft,
  type RoundRow,
} from '@/lib/rounds/rounds';
import { cn } from '@/lib/utils';

const RoundsMap = dynamic(() => import('@/components/maps/rounds-map').then((mod) => mod.RoundsMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-muted" aria-hidden="true" />,
});

const HEAT_OPTIONS: Array<{ value: HeatMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'money', label: 'Money' },
  { value: 'customers', label: 'Customers' },
];

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-xl bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
            value === o.value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        on
          ? 'border-(--tone-rounds-solid) bg-(--tone-rounds-soft) text-(--tone-rounds-text)'
          : 'border-border bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function compactGbp(n: number): string {
  const rounded = Math.round(n);
  return rounded >= 10_000 ? `£${(rounded / 1000).toFixed(rounded >= 100_000 ? 0 : 1)}k` : formatGbp(rounded);
}

/** The four numbers in one row: what a phone shows while the sheet is pulled down. */
function MiniStats({ items }: { items: Array<{ label: string; value: string; tone: Tone }> }) {
  return (
    <dl className="grid grid-cols-4 gap-2 lg:hidden">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-xl border border-border bg-card px-2 py-2 text-center">
          <dd className={cn('truncate text-base font-semibold tabular-nums', toneClasses(item.tone).figure)}>{item.value}</dd>
          <dt className="truncate text-[11px] text-muted-foreground">{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

type Selection = { ids: string[] } | null;

type DraftForm = { name: string; colour: string; error: string | null };

/**
 * Every customer on one full-height map, with a panel beside it (a pull-up
 * sheet on a phone). Layers switch on and off on their own; the numbers add up
 * whatever is in view. Rounds are made here, by drawing round pins or picking them.
 */
export function RoundsMapView({
  places,
  rounds,
  usualLeads,
  leadOptions,
  unmappedCustomers,
  notes,
}: {
  places: MapPlace[];
  rounds: RoundRow[];
  usualLeads: Record<string, string | null>;
  leadOptions: Array<{ workerId: string; name: string; isOwner: boolean }>;
  unmappedCustomers: number;
  notes: string[];
}) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [heat, setHeat] = useState<HeatMode>('money');
  const [showPins, setShowPins] = useState(true);
  const [showOutline, setShowOutline] = useState(true);
  const [showRounds, setShowRounds] = useState(true);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useStoredFlag('workwise-map-panel-open', true);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const panelHidden = isDesktop && !panelOpen;
  const [filterId, setFilterId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoundDraft | null>(null);
  const [form, setForm] = useState<DraftForm>({ name: '', colour: '#7c3aed', error: null });
  const onBounds = useCallback(
    (b: MapBounds) =>
      setBounds((prev) =>
        prev && prev.south === b.south && prev.west === b.west && prev.north === b.north && prev.east === b.east ? prev : b,
      ),
    [],
  );

  const filterRound = rounds.find((r) => r.id === filterId) ?? null;
  const scope = useMemo(
    () => (filterRound ? places.filter((p) => p.roundId === filterRound.id) : places),
    [places, filterRound],
  );
  const visible = useMemo(() => (bounds ? placesInBounds(scope, bounds) : scope), [scope, bounds]);
  const inView = useMemo(() => summarisePlaces(visible), [visible]);
  const all = useMemo(() => summarisePlaces(scope), [scope]);
  const allShown = visible.length === scope.length;
  const summaries = useMemo(() => summariseRounds(rounds, places), [rounds, places]);
  const outside = useMemo(() => places.filter((p) => p.roundId === null).length, [places]);

  const picked = useMemo(
    () => (selection ? places.filter((p) => selection.ids.includes(p.id)) : []),
    [places, selection],
  );
  const onePlace = picked.length === 1 ? picked[0]! : null;

  const draftPlaces = useMemo(
    () => (draft ? places.filter((p) => draft.picked.has(p.id)) : []),
    [places, draft],
  );
  const draftStats = useMemo(() => {
    const s = summarisePlaces(draftPlaces);
    return { customers: s.customers, places: draftPlaces.length, yearly: s.yearly };
  }, [draftPlaces]);
  const moving = draft ? movingFromOtherRounds(draft.picked, places, draft.editingId) : 0;

  const onSelect = useCallback((ids: string[]) => setSelection({ ids }), []);
  const onCloseSelection = useCallback(
    (key: string) => setSelection((s) => (s && s.ids.join(',') === key ? null : s)),
    [],
  );
  const onPickPlace = useCallback((id: string) => setSelection({ ids: [id] }), []);

  const chooseFilter = (id: string | null) => {
    setFilterId(id);
    setSelection(null);
    setFitKey((k) => k + 1);
  };

  const startNew = () => {
    setSelection(null);
    setFilterId(null);
    setDraft({ mode: 'draw', editingId: null, points: [], shape: null, picked: new Set() });
    setPanelOpen(true);
    setForm({ name: '', colour: nextRoundColour(rounds.map((r) => r.colour)), error: null });
    setSheetOpen(true);
  };

  const startEdit = (round: RoundRow) => {
    setSelection(null);
    setFilterId(null);
    setDraft({
      mode: 'pick',
      editingId: round.id,
      points: [],
      shape: null,
      picked: new Set(places.filter((p) => p.roundId === round.id).map((p) => p.id)),
    });
    setPanelOpen(true);
    setForm({ name: round.name, colour: round.colour, error: null });
    setSheetOpen(true);
  };

  const cancelDraft = () => {
    setDraft(null);
    setForm((f) => ({ ...f, error: null }));
  };

  const update = (change: Partial<RoundDraft>) => setDraft((d) => (d ? { ...d, ...change } : d));

  const onDrawPoint = useCallback((at: LatLng) => {
    setDraft((d) => (d && d.mode === 'draw' && !d.shape ? { ...d, points: [...d.points, at] } : d));
  }, []);

  const onPlaceClick = useCallback(
    (id: string, at: LatLng) => {
      if (!draft) {
        onSelect([id]);
        return;
      }
      if (draft.mode === 'draw' && !draft.shape) {
        onDrawPoint(at);
        return;
      }
      setDraft((d) => {
        if (!d) return d;
        const next = new Set(d.picked);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { ...d, picked: next };
      });
    },
    [draft, onSelect, onDrawPoint],
  );

  const finishShape = () => {
    if (!draft) return;
    if (draft.points.length < 3) {
      setForm((f) => ({ ...f, error: 'Drop at least three corners first.' }));
      return;
    }
    const inside = placesInShape(places, draft.points, draft.editingId).map((p) => p.id);
    setForm((f) => ({ ...f, error: null }));
    update({ shape: draft.points, points: [], picked: new Set([...draft.picked, ...inside]) });
  };

  const save = () => {
    if (!draft) return;
    const name = cleanRoundName(form.name);
    if (!name.ok) {
      setForm((f) => ({ ...f, error: name.error }));
      return;
    }
    if (roundNameTaken(name.name, rounds, draft.editingId)) {
      setForm((f) => ({ ...f, error: `You already have a round called ${name.name}.` }));
      return;
    }
    if (draft.picked.size === 0) {
      setForm((f) => ({ ...f, error: 'Pick at least one customer for the round.' }));
      return;
    }
    setForm((f) => ({ ...f, error: null }));
    startSaving(async () => {
      const result = await saveRound({
        id: draft.editingId,
        name: name.name,
        colour: form.colour,
        placeIds: [...draft.picked],
      });
      if (!result.success) {
        setForm((f) => ({ ...f, error: result.error }));
        return;
      }
      toast.success(`${name.name} saved`);
      setDraft(null);
      router.refresh();
    });
  };

  const usualLeadProps =
    draft?.editingId && leadOptions.length > 0
      ? {
          value: (() => {
            const current = usualLeads[draft.editingId] ?? null;
            return current ?? 'me';
          })(),
          options: leadOptions.map((o) => ({ value: o.isOwner ? 'me' : o.workerId, label: o.isOwner ? 'You' : o.name })),
          onChange: (value: string) => {
            const roundId = draft.editingId!;
            const who = leadOptions.find((o) => (o.isOwner ? 'me' : o.workerId) === value);
            const roundName = rounds.find((r) => r.id === roundId)?.name ?? 'the round';
            startSaving(async () => {
              const result = await setUsualLeadAction({ roundId, workerId: value === 'me' ? null : value });
              if (!result.success) {
                setForm((f) => ({ ...f, error: result.error }));
                return;
              }
              floatingMessage({
                title: `${who?.isOwner ? 'You' : (who?.name ?? 'They')} now usually ${who?.isOwner ? 'do' : 'does'} ${roundName}`,
                body:
                  result.repointed > 0
                    ? `${result.repointed} upcoming ${result.repointed === 1 ? 'visit has' : 'visits have'} moved ${who?.isOwner ? 'to you' : 'to them'}`
                    : undefined,
                tone: 'success',
              });
              router.refresh();
            });
          },
        }
      : undefined;

  const remove = () => {
    if (!draft?.editingId) return;
    const id = draft.editingId;
    startSaving(async () => {
      const result = await deleteRound(id);
      if (!result.success) {
        setForm((f) => ({ ...f, error: result.error }));
        return;
      }
      toast.success('Round deleted');
      setDraft(null);
      setFilterId(null);
      router.refresh();
    });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
      <div
        className={cn(
          'relative z-0 isolate min-h-0 flex-1 bg-muted',
          'dark:[&_.leaflet-tile-pane]:[filter:brightness(0.6)_contrast(1.1)]',
        )}
      >
        <RoundsMap
          places={places}
          rounds={rounds}
          heat={heat}
          showPins={showPins}
          showOutline={showOutline}
          showRounds={showRounds}
          filterRoundId={filterRound?.id ?? null}
          draft={draft}
          selectedId={onePlace?.id ?? null}
          selectedPlaces={picked}
          onSelect={onSelect}
          onCloseSelection={onCloseSelection}
          onPickPlace={onPickPlace}
          onPlaceClick={onPlaceClick}
          onDrawPoint={onDrawPoint}
          fitKey={fitKey}
          onBounds={onBounds}
        />
        <button
          type="button"
          onClick={() => setPanelOpen(!panelOpen)}
          aria-expanded={panelOpen}
          aria-controls="map-panel"
          aria-label={panelOpen ? 'Hide the panel' : 'Show the panel'}
          title={panelOpen ? 'Hide the panel' : 'Show the panel'}
          className="absolute top-1/2 right-0 z-[1000] hidden h-16 w-6 -translate-y-1/2 items-center justify-center rounded-l-xl border border-r-0 border-border bg-card text-muted-foreground shadow-md transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none lg:flex"
        >
          {panelOpen ? <ChevronRight className="size-4" aria-hidden="true" /> : <ChevronLeft className="size-4" aria-hidden="true" />}
        </button>
      </div>

      <aside
        id="map-panel"
        inert={panelHidden}
        aria-hidden={panelHidden || undefined}
        className={cn(
          'z-10 flex flex-col border-border bg-background',
          'max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:rounded-t-3xl max-lg:border-t max-lg:shadow-[0_-8px_30px_rgba(15,23,42,0.18)]',
          sheetOpen ? 'max-lg:h-[78%]' : 'max-lg:h-[176px]',
          'lg:shrink-0 lg:overflow-hidden lg:transition-[width] lg:duration-300 lg:ease-out',
          panelOpen ? 'lg:w-[380px] lg:border-l' : 'lg:w-0 lg:border-l-0',
        )}
      >
        <button
          type="button"
          onClick={() => setSheetOpen((v) => !v)}
          aria-expanded={sheetOpen}
          aria-label={sheetOpen ? 'Show less' : 'Show more'}
          className="flex w-full shrink-0 justify-center pt-2 pb-1 lg:hidden"
        >
          <span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            <ChevronUp className={cn('size-3.5 transition-transform', sheetOpen && 'rotate-180')} aria-hidden="true" />
            {sheetOpen ? 'Show less' : 'Show more'}
          </span>
        </button>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pt-2 pb-6 lg:w-[380px] lg:shrink-0 lg:p-5">
          <div className="flex items-center justify-between gap-3 lg:hidden">
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
              {filterRound ? (
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: filterRound.colour }} aria-hidden="true" />
              ) : null}
              <span className="truncate">
                {filterRound ? filterRound.name : allShown ? 'Whole area' : `In view: ${inView.customers.toLocaleString()} of ${all.customers.toLocaleString()}`}
              </span>
            </p>
            {allShown && !filterRound ? null : (
              <Button type="button" variant="outline" size="xs" onClick={() => (filterRound ? chooseFilter(null) : setFitKey((k) => k + 1))}>
                {filterRound ? 'Whole area' : 'Show everything'}
              </Button>
            )}
          </div>
          <MiniStats
            items={[
              { label: 'Customers', value: inView.customers.toLocaleString(), tone: 'sky' },
              { label: 'A year', value: compactGbp(inView.yearly), tone: 'emerald' },
              { label: 'Visits', value: inView.visitsThisMonth.toLocaleString(), tone: 'indigo' },
              { label: 'Owed', value: compactGbp(inView.owed), tone: 'rose' },
            ]}
          />

          <div className="hidden items-end justify-between gap-3 lg:flex">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                {filterRound ? (
                  <span className="size-3 shrink-0 rounded-full" style={{ background: filterRound.colour }} aria-hidden="true" />
                ) : null}
                <span className="truncate">{filterRound ? filterRound.name : 'Map'}</span>
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {allShown
                  ? filterRound
                    ? 'This round'
                    : 'Whole area'
                  : `In view: ${inView.customers.toLocaleString()} of ${all.customers.toLocaleString()} customers`}
              </p>
            </div>
            {allShown ? null : (
              <Button type="button" variant="outline" size="sm" onClick={() => setFitKey((k) => k + 1)}>
                Show everything
              </Button>
            )}
          </div>

          {draft ? (
            <RoundEditor
              editing={draft.editingId !== null}
              mode={draft.mode}
              corners={draft.points.length}
              shapeDone={draft.shape !== null}
              name={form.name}
              colour={form.colour}
              picked={draftStats}
              moving={moving}
              error={form.error}
              saving={saving}
              onMode={(mode) => update({ mode })}
              onUndoCorner={() => update({ points: draft.points.slice(0, -1) })}
              onFinishShape={finishShape}
              onRedraw={() => update({ shape: null, points: [] })}
              onClearPicks={() => update({ picked: new Set() })}
              onName={(name) => setForm((f) => ({ ...f, name, error: null }))}
              onColour={(colour) => setForm((f) => ({ ...f, colour }))}
              onSave={save}
              onCancel={cancelDraft}
              onDelete={remove}
              usualLead={usualLeadProps}
            />
          ) : null}

          <div className="hidden grid-cols-2 gap-3 lg:grid">
            <StatTile label="Customers" value={inView.customers.toLocaleString()} tone="sky" icon={Users} />
            <StatTile label="Yearly value" value={formatGbp(Math.round(inView.yearly))} tone="emerald" icon={PoundSterling} sub="at today's prices" />
            <StatTile label="Visits" value={inView.visitsThisMonth.toLocaleString()} tone="indigo" icon={CalendarDays} sub="booked this month" />
            <StatTile label="Owed" value={formatGbp(inView.owed)} tone="rose" icon={Wallet} sub="to chase" />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Rounds</h2>
              {draft ? null : (
                <Button type="button" variant="outline" size="xs" onClick={startNew}>
                  <Plus className="size-3" />
                  New round
                </Button>
              )}
            </div>
            {summaries.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
                Group your customers into rounds, like &ldquo;Tuesday north&rdquo;, to see each one on the map and filter by it.
                Draw round a patch of pins, or pick customers one by one.
              </p>
            ) : (
              <ul className="space-y-1.5">
                <li>
                  <button
                    type="button"
                    onClick={() => chooseFilter(null)}
                    aria-pressed={!filterRound}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                      !filterRound ? 'border-(--tone-rounds-solid) bg-(--tone-rounds-soft)' : 'border-border bg-card hover:border-border/80',
                    )}
                  >
                    <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden="true" />
                    <span className="flex-1 font-medium">Whole area</span>
                    <span className="text-xs text-muted-foreground">{all.customers.toLocaleString()}</span>
                  </button>
                </li>
                {summaries.map((round) => (
                  <li key={round.id} className="flex items-stretch gap-1.5">
                    <button
                      type="button"
                      onClick={() => chooseFilter(filterRound?.id === round.id ? null : round.id)}
                      aria-pressed={filterRound?.id === round.id}
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                        filterRound?.id === round.id
                          ? 'border-(--tone-rounds-solid) bg-(--tone-rounds-soft)'
                          : 'border-border bg-card hover:border-border/80',
                      )}
                    >
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: round.colour }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-medium">{round.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {round.customers.toLocaleString()} · {compactGbp(round.yearly)}
                      </span>
                    </button>
                    {draft ? null : (
                      <Button type="button" variant="ghost" size="icon" onClick={() => startEdit(round)} aria-label={`Edit ${round.name}`}>
                        <Pencil className="size-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {summaries.length > 0 && outside > 0 ? (
              <p className="text-xs text-muted-foreground">
                {plural(outside, 'place isn’t', 'places aren’t')} in a round yet.
              </p>
            ) : null}
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Heatmap</h2>
            <Segmented label="Heatmap" value={heat} options={HEAT_OPTIONS} onChange={setHeat} />
            {heat !== 'off' ? (
              <div>
                <div className="h-2.5 rounded-full" style={{ background: RAMP_CSS }} aria-hidden="true" />
                <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>Quieter</span>
                  <span>Busier</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {heat === 'money' ? 'Where your regular money is.' : 'Where your customers are.'} Compared with your own
                  busiest spot. Hover the map for the numbers, and zoom in to see each customer.
                </p>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Show</h2>
            <div className="flex flex-wrap gap-2">
              <Chip on={showPins} onClick={() => setShowPins((v) => !v)}>
                Pins
              </Chip>
              <Chip on={showRounds} onClick={() => setShowRounds((v) => !v)}>
                Rounds
              </Chip>
              <Chip on={showOutline} onClick={() => setShowOutline((v) => !v)}>
                Area outline
              </Chip>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              {(['owes', 'due', 'fine'] as const).map((state) => (
                <span key={state} className="inline-flex items-center gap-1.5">
                  <span
                    className="size-3 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(15,23,42,0.2)]"
                    style={{ background: PIN_COLOURS[state].fill }}
                    aria-hidden="true"
                  />
                  {PIN_COLOURS[state].label}
                </span>
              ))}
            </div>
          </div>

          {unmappedCustomers > 0 ? (
            <div className="flex items-start gap-3 rounded-2xl border border-(--tone-amber-line) bg-(--tone-amber-soft) p-3.5 text-sm">
              <MapPinOff className="mt-0.5 size-4 shrink-0 text-(--tone-amber-text)" aria-hidden="true" />
              <p className="text-foreground">
                {plural(unmappedCustomers, 'customer isn’t', 'customers aren’t')} on the map because their address couldn’t be
                placed, so they can’t be put in a round yet.{' '}
                <Link href="/customers" className="font-medium text-primary hover:underline">
                  Check their postcodes
                </Link>
              </p>
            </div>
          ) : null}

          {notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      </aside>
    </div>
  );
}
