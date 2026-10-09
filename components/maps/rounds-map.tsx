'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  outlineAround,
  PIN_COLOURS,
  pinState,
  type HeatMode,
  type LatLng,
  type MapBounds,
  type MapPlace,
} from '@/lib/rounds/map-areas';
import { groupPlaces, type PlaceGroup } from '@/lib/rounds/map-cluster';
import type { RoundDraft, RoundRow } from '@/lib/rounds/rounds';
import {
  aroundPoint,
  buildDensity,
  centreLatitude,
  glowPoints,
  makeProjection,
  rampColour,
  type Around,
} from '@/lib/rounds/map-heat';
import { formatGbp } from '@/lib/money/pence';
import { MapPlaceCard, MapPlaceList } from '@/components/rounds/map-place-card';

const OUTLINE_MARGIN_METRES = 600;
/** How far one customer's warmth spreads, in metres. */
const GLOW_SIGMA = 650;
/** The glow is worked out one block of this many pixels at a time, then smoothed up. */
const GLOW_BLOCK_PX = 5;
/** With the heatmap on, pins only appear from this zoom: any further out they would sit on top of the glow. */
export const PINS_WITH_HEAT_MIN_ZOOM = 12;
const AROUND_METRES = 1000;
const EQUATOR_METRES = 40_075_016.686;

function toBounds(map: L.Map): MapBounds {
  const b = map.getBounds();
  return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
}

function metresPerPixel(map: L.Map): number {
  const lat = map.getCenter().lat;
  return (EQUATOR_METRES * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** map.getZoom());
}

function ViewWatcher({ onBounds }: { onBounds: (b: MapBounds) => void }) {
  const map = useMapEvents({
    moveend: () => onBounds(toBounds(map)),
    zoomend: () => onBounds(toBounds(map)),
  });
  useEffect(() => {
    onBounds(toBounds(map));
  }, [map, onBounds]);
  return null;
}

/** Leaflet only measures its box once; tell it when the box changes (sidebar, rotation, window). */
function ResizeWatcher() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Fits everything on first load and again whenever `fitKey` changes. */
function FitAll({ places, fitKey }: { places: MapPlace[]; fitKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (places.length === 0) return;
    // The map is created inside a box that is still settling its size.
    map.invalidateSize();
    if (places.length === 1) {
      map.setView([places[0]!.lat, places[0]!.lng], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(places.map((p) => [p.lat, p.lng] as [number, number])), { padding: [60, 60] });
    // Refit only when asked, not whenever the list object changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

/* ---------- Heat: one canvas under the pins, drawn as a smooth glow or as tiles ---------- */

function HeatCanvas({
  places,
  metric,
  onAround,
}: {
  places: MapPlace[];
  metric: 'money' | 'customers';
  onAround: (a: { x: number; y: number; label: string; around: Around } | null) => void;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef(0);
  const projection = useMemo(() => makeProjection(centreLatitude(places)), [places]);
  const points = useMemo(() => glowPoints(places, projection.project, metric), [places, projection, metric]);
  const field = useMemo(() => buildDensity(points, GLOW_SIGMA), [points]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = map.getSize();
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    canvas.width = size.x;
    canvas.height = size.y;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size.x, size.y);
    const mpp = metresPerPixel(map);

    // Zoomed far out the warmth would shrink to specks; keep it at least a few pixels wide.
    const sigma = Math.max(GLOW_SIGMA, 14 * mpp);
    const active = sigma === GLOW_SIGMA ? field : buildDensity(points, sigma);
    const gw = Math.ceil(size.x / GLOW_BLOCK_PX);
    const gh = Math.ceil(size.y / GLOW_BLOCK_PX);
    // Longitude depends only on x and latitude only on y, so look each up once.
    const xs = new Float64Array(gw);
    const ys = new Float64Array(gh);
    for (let gx = 0; gx < gw; gx += 1) {
      const ll = map.containerPointToLatLng([gx * GLOW_BLOCK_PX + GLOW_BLOCK_PX / 2, 0]);
      xs[gx] = projection.project(0, ll.lng).x;
    }
    for (let gy = 0; gy < gh; gy += 1) {
      const ll = map.containerPointToLatLng([0, gy * GLOW_BLOCK_PX + GLOW_BLOCK_PX / 2]);
      ys[gy] = projection.project(ll.lat, 0).y;
    }
    const values = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy += 1) {
      for (let gx = 0; gx < gw; gx += 1) {
        const v = active.at(xs[gx]!, ys[gy]!);
        values[gy * gw + gx] = v;
      }
    }
    // The busiest tenth of places reach the hot end, whatever the zoom.
    const denom = Math.max(active.busy * 1.15, 1e-9);
    const image = ctx.createImageData(gw, gh);
    for (let i = 0; i < values.length; i += 1) {
      const c = rampColour((values[i]! / denom) ** 0.8);
      image.data[i * 4] = c.r;
      image.data[i * 4 + 1] = c.g;
      image.data[i * 4 + 2] = c.b;
      image.data[i * 4 + 3] = Math.round(c.a * 255);
    }
    const small = document.createElement('canvas');
    small.width = gw;
    small.height = gh;
    small.getContext('2d')?.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, gw * GLOW_BLOCK_PX, gh * GLOW_BLOCK_PX);
  }, [map, field, points, projection]);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  }, [draw]);

  useEffect(() => {
    const pane = map.getPane('wwheat') ?? map.createPane('wwheat');
    pane.style.zIndex = '420';
    pane.style.pointerEvents = 'none';
    const canvas = document.createElement('canvas');
    canvas.style.transition = 'opacity 0.2s';
    canvas.className = 'leaflet-zoom-hide';
    pane.appendChild(canvas);
    canvasRef.current = canvas;
    return () => {
      pane.removeChild(canvas);
      canvasRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const hide = () => {
      if (canvasRef.current) canvasRef.current.style.opacity = '0';
    };
    const settled = () => {
      draw();
      if (canvasRef.current) canvasRef.current.style.opacity = '1';
    };
    map.on('move', schedule);
    map.on('zoomstart', hide);
    map.on('zoomend', settled);
    map.on('resize', schedule);
    draw();
    return () => {
      map.off('move', schedule);
      map.off('zoomstart', hide);
      map.off('zoomend', settled);
      map.off('resize', schedule);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [map, draw, schedule]);

  // What's around the pointer: the figures behind the colour, without a grid of "customers".
  useMapEvents({
    mousemove: (e) => {
      const at = projection.project(e.latlng.lat, e.latlng.lng);
      const around = aroundPoint(places, projection.project, at, AROUND_METRES);
      onAround(
        around.customers === 0
          ? null
          : { x: e.containerPoint.x, y: e.containerPoint.y, label: 'Within a kilometre', around },
      );
    },
    mouseout: () => onAround(null),
    movestart: () => onAround(null),
  });
  return null;
}

/* ---------- Pins and groups ---------- */

const iconCache = new Map<string, L.DivIcon>();

function pinIcon(state: keyof typeof PIN_COLOURS, selected: boolean, dim: boolean): L.DivIcon {
  const key = `pin:${state}:${selected}:${dim}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const fill = PIN_COLOURS[state].fill;
  const icon = L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div class="flex size-7 items-center justify-center ${dim ? 'opacity-35' : ''}"><span class="block rounded-full border-[3px] border-white shadow-[0_1px_5px_rgba(15,23,42,0.45)] transition-transform hover:scale-125 ${
      selected ? 'size-[22px] ring-[3px] ring-[#0c447c]' : 'size-[18px]'
    }" style="background:${fill}"></span></div>`,
  });
  iconCache.set(key, icon);
  return icon;
}

function groupIcon(count: number, hasOwes: boolean): L.DivIcon {
  const key = `group:${count}:${hasOwes}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const px = count < 10 ? 34 : count < 100 ? 40 : 46;
  const icon = L.divIcon({
    className: '',
    iconSize: [px + 8, px + 8],
    iconAnchor: [(px + 8) / 2, (px + 8) / 2],
    html: `<div class="relative flex items-center justify-center" style="width:${px + 8}px;height:${px + 8}px"><span class="flex items-center justify-center rounded-full border-[3px] border-white bg-[#0c66e4] text-[13px] font-semibold text-white shadow-[0_1px_6px_rgba(15,23,42,0.5)] ring-[6px] ring-[#0c66e4]/25 transition-transform hover:scale-110" style="width:${px}px;height:${px}px">${count}</span>${
      hasOwes ? '<span class="absolute top-0 right-0 size-3.5 rounded-full border-2 border-white bg-[#e11d48]"></span>' : ''
    }</div>`,
  });
  iconCache.set(key, icon);
  return icon;
}

function PlaceMarkers({
  places,
  zoom,
  heatOn,
  creating,
  selectedId,
  isPicked,
  isDimmed,
  onSelect,
  onPlaceClick,
}: {
  places: MapPlace[];
  zoom: number;
  heatOn: boolean;
  /** Making a round: every place is its own dot, at any zoom, so each can be picked. */
  creating: boolean;
  selectedId: string | null;
  isPicked: (p: MapPlace) => boolean;
  isDimmed: (p: MapPlace) => boolean;
  onSelect: (ids: string[]) => void;
  onPlaceClick: (id: string, at: LatLng) => void;
}) {
  const map = useMap();
  const [view, setView] = useState<L.LatLngBounds | null>(null);
  useMapEvents({ moveend: () => setView(map.getBounds().pad(0.3)) });

  // With the heatmap on, the glow is the picture: no bubbles, no numbers, and no pins at all until you're close.
  const dots = useMemo(() => {
    if (creating) return places;
    if (!heatOn) return [];
    if (zoom < PINS_WITH_HEAT_MIN_ZOOM) return places.filter((p) => p.id === selectedId);
    return view ? places.filter((p) => view.contains([p.lat, p.lng])) : places;
  }, [creating, heatOn, zoom, places, selectedId, view]);
  const groups = useMemo(() => (creating || heatOn ? [] : groupPlaces(places, zoom)), [creating, heatOn, places, zoom]);

  const openGroup = (group: PlaceGroup) => {
    const bounds = L.latLngBounds(group.members.map((m) => [m.lat, m.lng] as [number, number]));
    const atMax = map.getZoom() >= map.getMaxZoom();
    const together = bounds.getNorthEast().equals(bounds.getSouthWest());
    if (atMax || together) onSelect(group.members.map((m) => m.id));
    else map.fitBounds(bounds, { padding: [80, 80], maxZoom: map.getMaxZoom() });
  };

  const single = (place: MapPlace, key: string, lat: number, lng: number) => (
    <Marker
      key={key}
      position={[lat, lng]}
      icon={pinIcon(pinState(place), creating ? isPicked(place) : place.id === selectedId, isDimmed(place))}
      eventHandlers={{ click: (e) => onPlaceClick(place.id, [e.latlng.lat, e.latlng.lng]) }}
      keyboard={false}
    />
  );

  return (
    <>
      {dots.map((place) => single(place, place.id, place.lat, place.lng))}
      {groups.map((group) =>
        group.members.length === 1 ? (
          single(group.members[0]!, group.key, group.lat, group.lng)
        ) : (
          <Marker
            key={group.key}
            position={[group.lat, group.lng]}
            icon={groupIcon(group.members.length, group.members.some((m) => m.owes))}
            eventHandlers={{ click: () => openGroup(group) }}
            keyboard={false}
          />
        ),
      )}
    </>
  );
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => {
    onZoom(map.getZoom());
  }, [map, onZoom]);
  return null;
}

/* ---------- The customer card, floating above the pin you tapped ---------- */

/** On a phone the pull-up sheet covers the bottom of the map; keep the card clear of it. */
function sheetClearance(): number {
  return typeof window !== 'undefined' && window.innerWidth < 1024 ? 200 : 24;
}

function SelectedPopup({
  places,
  rounds,
  onClose,
  onPick,
}: {
  places: MapPlace[];
  rounds: RoundRow[];
  onClose: (key: string) => void;
  onPick: (id: string) => void;
}) {
  const key = places.map((p) => p.id).join(',');
  const lat = places.reduce((sum, p) => sum + p.lat, 0) / places.length;
  const lng = places.reduce((sum, p) => sum + p.lng, 0) / places.length;
  // Same position and handlers on every render, or Leaflet re-pans the map each time and the page loops.
  const position = useMemo<LatLng>(() => [lat, lng], [lat, lng]);
  const close = useCallback(() => onClose(key), [onClose, key]);
  const handlers = useMemo(() => ({ remove: close }), [close]);
  const single = places.length === 1 ? places[0]! : null;
  return (
    <Popup
      key={key}
      position={position}
      className="ww-place-popup"
      closeButton={false}
      minWidth={300}
      maxWidth={300}
      offset={[0, -14]}
      autoPanPaddingTopLeft={[24, 24]}
      autoPanPaddingBottomRight={[24, sheetClearance()]}
      eventHandlers={handlers}
    >
      {single ? (
        <MapPlaceCard place={single} round={rounds.find((r) => r.id === single.roundId) ?? null} onClose={close} />
      ) : (
        <MapPlaceList places={places} onPick={onPick} onClose={close} />
      )}
    </Popup>
  );
}

/* ---------- Rounds: each one's area, and the shape being drawn ---------- */

const ROUND_MARGIN_METRES = 350;

function RoundAreas({
  places,
  rounds,
  filterId,
}: {
  places: MapPlace[];
  rounds: RoundRow[];
  filterId: string | null;
}) {
  const areas = useMemo(
    () =>
      rounds
        .map((round) => {
          const members = places.filter((p) => p.roundId === round.id).map((p) => [p.lat, p.lng] as LatLng);
          return { round, outline: outlineAround(members, ROUND_MARGIN_METRES) };
        })
        .filter((a) => a.outline.length > 2),
    [places, rounds],
  );
  return (
    <>
      {areas.map(({ round, outline }) => {
        const chosen = filterId === round.id;
        const faded = filterId !== null && !chosen;
        return (
          <Polygon
            key={round.id}
            positions={outline}
            interactive={false}
            pathOptions={{
              color: round.colour,
              weight: chosen ? 3 : 2,
              opacity: faded ? 0.3 : 0.9,
              fillColor: round.colour,
              fillOpacity: faded ? 0.03 : chosen ? 0.16 : 0.1,
              lineJoin: 'round',
            }}
          >
            <Tooltip permanent direction="center" className="ww-round-label" opacity={faded ? 0.5 : 1}>
              <span style={{ color: round.colour }}>{round.name}</span>
            </Tooltip>
          </Polygon>
        );
      })}
    </>
  );
}

function DrawLayer({ draft, onPoint }: { draft: RoundDraft; onPoint: (at: LatLng) => void }) {
  const map = useMap();
  const drawing = draft.mode === 'draw' && !draft.shape;
  useMapEvents({
    click: (e) => {
      if (drawing) onPoint([e.latlng.lat, e.latlng.lng]);
    },
  });
  useEffect(() => {
    const container = map.getContainer();
    map.doubleClickZoom.disable();
    container.style.cursor = drawing ? 'crosshair' : '';
    return () => {
      map.doubleClickZoom.enable();
      container.style.cursor = '';
    };
  }, [map, drawing]);
  const colour = '#0c66e4';
  return (
    <>
      {draft.shape ? (
        <Polygon
          positions={draft.shape}
          interactive={false}
          pathOptions={{ color: colour, weight: 2, dashArray: '6 5', fillColor: colour, fillOpacity: 0.1 }}
        />
      ) : null}
      {draft.points.length > 1 ? (
        <Polyline positions={draft.points} interactive={false} pathOptions={{ color: colour, weight: 2.5 }} />
      ) : null}
      {draft.points.map((p, i) => (
        <CircleMarker
          key={`${i}:${p[0]}:${p[1]}`}
          center={p}
          radius={5}
          interactive={false}
          pathOptions={{ color: '#fff', weight: 2, fillColor: colour, fillOpacity: 1 }}
        />
      ))}
    </>
  );
}

/* ---------- The map ---------- */

export function RoundsMap({
  places,
  rounds,
  heat,
  showPins,
  showOutline,
  showRounds,
  filterRoundId,
  draft,
  selectedId,
  selectedPlaces,
  onSelect,
  onCloseSelection,
  onPickPlace,
  onPlaceClick,
  onDrawPoint,
  fitKey,
  onBounds,
}: {
  places: MapPlace[];
  rounds: RoundRow[];
  heat: HeatMode;
  showPins: boolean;
  showOutline: boolean;
  showRounds: boolean;
  /** Show only this round's heat and numbers; the rest of the pins fade. */
  filterRoundId: string | null;
  /** A round being made or edited. */
  draft: RoundDraft | null;
  selectedId: string | null;
  /** The places whose card is open: one customer, or several stacked on the same spot. */
  selectedPlaces: MapPlace[];
  onSelect: (ids: string[]) => void;
  /** The card closed itself; `key` says which selection, so a newer one isn't cleared by mistake. */
  onCloseSelection: (key: string) => void;
  onPickPlace: (id: string) => void;
  onPlaceClick: (id: string, at: LatLng) => void;
  onDrawPoint: (at: LatLng) => void;
  fitKey: number;
  onBounds: (b: MapBounds) => void;
}) {
  const [zoom, setZoom] = useState(10);
  const [around, setAround] = useState<{ x: number; y: number; label: string; around: Around } | null>(null);
  const first = places[0];
  const scope = useMemo(
    () => (filterRoundId ? places.filter((p) => p.roundId === filterRoundId) : places),
    [places, filterRoundId],
  );
  const outline = useMemo(
    () => outlineAround(scope.map((p) => [p.lat, p.lng] as [number, number]), OUTLINE_MARGIN_METRES),
    [scope],
  );
  const creating = draft !== null;
  const isPicked = useCallback((p: MapPlace) => draft?.picked.has(p.id) ?? false, [draft]);
  const isDimmed = useCallback(
    (p: MapPlace) => {
      if (draft) return p.roundId !== null && p.roundId !== draft.editingId && !draft.picked.has(p.id);
      return filterRoundId !== null && p.roundId !== filterRoundId;
    },
    [draft, filterRoundId],
  );
  if (!first) return null;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[first.lat, first.lng]}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution="Tiles &copy; Esri"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          maxZoom={16}
        />
        <FitAll places={scope.length > 0 ? scope : places} fitKey={fitKey} />
        <ViewWatcher onBounds={onBounds} />
        <ResizeWatcher />
        <ZoomWatcher onZoom={setZoom} />
        {heat !== 'off' && scope.length > 0 ? (
          <HeatCanvas places={scope} metric={heat} onAround={setAround} />
        ) : null}
        {showOutline && outline.length > 2 ? (
          <Polygon
            positions={outline}
            interactive={false}
            pathOptions={{
              color: '#475569',
              weight: 2,
              dashArray: '8 6',
              fill: false,
              lineJoin: 'round',
            }}
          />
        ) : null}
        {showRounds ? <RoundAreas places={places} rounds={rounds} filterId={filterRoundId} /> : null}
        {draft ? <DrawLayer draft={draft} onPoint={onDrawPoint} /> : null}
        {showPins || creating ? (
          <PlaceMarkers
            places={places}
            zoom={zoom}
            heatOn={heat !== 'off'}
            creating={creating}
            selectedId={selectedId}
            isPicked={isPicked}
            isDimmed={isDimmed}
            onSelect={onSelect}
            onPlaceClick={onPlaceClick}
          />
        ) : null}
        {!creating && selectedPlaces.length > 0 ? (
          <SelectedPopup places={selectedPlaces} rounds={rounds} onClose={onCloseSelection} onPick={onPickPlace} />
        ) : null}
      </MapContainer>
      {!creating && showPins && heat !== 'off' && zoom < PINS_WITH_HEAT_MIN_ZOOM ? (
        <p className="pointer-events-none absolute bottom-8 left-3 z-[1000] rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
          Zoom in to see individual customers
        </p>
      ) : null}
      {!creating && around && heat !== 'off' ? (
        <div
          className="pointer-events-none absolute z-[1000] -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-xl border border-border bg-card/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
          style={{ left: around.x, top: around.y }}
        >
          <p className="font-medium text-muted-foreground">{around.label}</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
            {around.around.customers.toLocaleString()} {around.around.customers === 1 ? 'customer' : 'customers'}
            <span className="font-normal text-muted-foreground"> · </span>
            {formatGbp(Math.round(around.around.yearly))} a year
          </p>
        </div>
      ) : null}
    </div>
  );
}
