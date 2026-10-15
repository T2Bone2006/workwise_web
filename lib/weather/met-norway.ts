import { addDays, type Ymd } from '@/lib/rounds/dates';

/*
 * MET Norway locationforecast → one plain summary per London day. Pure: no
 * fetching, never throws on odd data (returns []). Terms: credit MET Norway,
 * identify ourselves in the request, cache responses (lib/data/weather.ts).
 */

export type WeatherSymbol =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'heavy_rain'
  | 'sleet'
  | 'snow'
  | 'thunder';

export type DayWeather = {
  date: Ymd;
  symbol: WeatherSymbol;
  /** Plain words, e.g. "Light rain". */
  label: string;
  highC: number;
  lowC: number;
  /** Rain during the working day (07:00–18:00 London), 1 decimal. */
  rainMm: number;
  /** 1 mm or more during the working day. */
  wet: boolean;
};

/** Forecast by London day. A plain object (not a Map) so it can be passed to client components. */
export type WeatherByDay = Record<string, DayWeather>;

/** Today and the next 8 days. */
const DAYS = 9;
/** A day with fewer forecast entries than this is the clipped end of the forecast. */
const MIN_ENTRIES = 4;
const WET_MM = 1;
const WORK_FROM_HOUR = 7;
const WORK_TO_HOUR = 18; // exclusive

const LABELS: Record<WeatherSymbol, string> = {
  clear: 'Sunny',
  partly: 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',
  drizzle: 'Light rain',
  rain: 'Rain',
  heavy_rain: 'Heavy rain',
  sleet: 'Sleet',
  snow: 'Snow',
  thunder: 'Thunderstorms',
};

/** 'lightrainshowers_day' → 'drizzle'. Unknown codes read as cloudy. */
export function symbolFor(code: string): WeatherSymbol {
  const base = code.replace(/_(day|night|polartwilight)$/, '');
  if (base.includes('thunder')) return 'thunder';
  if (base.includes('snow')) return 'snow';
  if (base.includes('sleet')) return 'sleet';
  if (base.includes('heavyrain')) return 'heavy_rain';
  if (base.includes('lightrain')) return 'drizzle';
  if (base.includes('rain')) return 'rain';
  if (base === 'fog') return 'fog';
  if (base === 'clearsky' || base === 'fair') return 'clear';
  if (base === 'partlycloudy') return 'partly';
  return 'cloudy';
}

const londonParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

function londonDayAndHour(at: Date): { date: Ymd; hour: number } {
  const parts = Object.fromEntries(londonParts.formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

type Entry = {
  date: Ymd;
  hour: number;
  temp: number | null;
  /** Rain over the hour(s) this entry starts, from next_1_hours if given, else next_6_hours. */
  rain: number | null;
  /** Hours that `rain` covers. */
  rainHours: 1 | 6;
  symbol: string | null;
};

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readEntry(raw: unknown): Entry | null {
  const item = obj(raw);
  const time = typeof item?.time === 'string' ? new Date(item.time) : null;
  const data = obj(item?.data);
  if (!time || Number.isNaN(time.getTime()) || !data) return null;

  const hourly = obj(data.next_1_hours);
  const sixHourly = obj(data.next_6_hours);
  const rainSource = hourly ?? sixHourly;
  const symbolSource = sixHourly ?? hourly ?? obj(data.next_12_hours);
  const symbol = obj(symbolSource?.summary)?.symbol_code;

  return {
    ...londonDayAndHour(time),
    temp: num(obj(obj(data.instant)?.details)?.air_temperature),
    rain: num(obj(rainSource?.details)?.precipitation_amount),
    rainHours: hourly ? 1 : 6,
    symbol: typeof symbol === 'string' ? symbol : null,
  };
}

export function summariseForecast(raw: unknown, now: Date = new Date()): DayWeather[] {
  const series = obj(obj(raw)?.properties)?.timeseries;
  if (!Array.isArray(series)) return [];

  const today = londonDayAndHour(now).date;
  const last = addDays(today, DAYS - 1);
  const byDay = new Map<Ymd, Entry[]>();
  for (const item of series) {
    const entry = readEntry(item);
    if (!entry || entry.date < today || entry.date > last) continue;
    byDay.set(entry.date, [...(byDay.get(entry.date) ?? []), entry]);
  }

  const days: DayWeather[] = [];
  for (const [date, entries] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (entries.length < MIN_ENTRIES) continue;
    const temps = entries.map((e) => e.temp).filter((t): t is number => t !== null);
    if (temps.length === 0) continue;

    let rainMm = 0;
    for (const e of entries) {
      const inWorkingDay = e.hour >= WORK_FROM_HOUR - (e.rainHours === 6 ? 1 : 0) && e.hour < WORK_TO_HOUR;
      if (e.rain !== null && inWorkingDay) rainMm += e.rain;
    }

    const nearestNoon = entries
      .filter((e) => e.symbol !== null)
      .sort((a, b) => Math.abs(a.hour - 12) - Math.abs(b.hour - 12))[0];
    const symbol = symbolFor(nearestNoon?.symbol ?? 'cloudy');
    rainMm = Math.round(rainMm * 10) / 10;

    days.push({
      date,
      symbol,
      label: LABELS[symbol],
      highC: Math.round(Math.max(...temps)),
      lowC: Math.round(Math.min(...temps)),
      rainMm,
      wet: rainMm >= WET_MM,
    });
  }
  return days;
}
