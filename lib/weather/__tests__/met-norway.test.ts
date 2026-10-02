import { describe, expect, it } from 'vitest';
import { summariseForecast, symbolFor } from '@/lib/weather/met-norway';

type Slot = { time: string; temp: number; rain1?: number; rain6?: number; code?: string };

function series(slots: Slot[]) {
  return {
    properties: {
      timeseries: slots.map((s) => ({
        time: s.time,
        data: {
          instant: { details: { air_temperature: s.temp } },
          ...(s.rain1 !== undefined
            ? { next_1_hours: { summary: { symbol_code: s.code ?? 'cloudy' }, details: { precipitation_amount: s.rain1 } } }
            : {}),
          ...(s.rain6 !== undefined
            ? { next_6_hours: { summary: { symbol_code: s.code ?? 'cloudy' }, details: { precipitation_amount: s.rain6 } } }
            : {}),
        },
      })),
    },
  };
}

/** Hourly slots for one UTC day between two hours (inclusive). */
function hourly(day: string, from: number, to: number, make: (hour: number) => Partial<Slot>): Slot[] {
  return Array.from({ length: to - from + 1 }, (_, i) => {
    const hour = from + i;
    return { time: `${day}T${String(hour).padStart(2, '0')}:00:00Z`, temp: 10, rain1: 0, ...make(hour) };
  });
}

// Thursday 1 Oct 2026, London is on BST (UTC+1).
const NOW = new Date('2026-10-01T08:00:00Z');

describe('symbolFor', () => {
  it('maps MET codes to the ten symbols', () => {
    expect(symbolFor('clearsky_day')).toBe('clear');
    expect(symbolFor('fair_night')).toBe('clear');
    expect(symbolFor('partlycloudy_day')).toBe('partly');
    expect(symbolFor('lightrainshowers_day')).toBe('drizzle');
    expect(symbolFor('rainshowers_day')).toBe('rain');
    expect(symbolFor('heavyrain')).toBe('heavy_rain');
    expect(symbolFor('lightssleetshowersandthunder_day')).toBe('thunder');
    expect(symbolFor('heavysnow')).toBe('snow');
    expect(symbolFor('sleet')).toBe('sleet');
    expect(symbolFor('fog')).toBe('fog');
    expect(symbolFor('something_new')).toBe('cloudy');
  });
});

describe('summariseForecast', () => {
  it('gives high, low, symbol and working-day rain for a wet day', () => {
    const slots = hourly('2026-10-02', 0, 23, (h) => ({
      temp: h === 13 ? 14.4 : h === 3 ? 7.6 : 10,
      rain1: h >= 8 && h <= 10 ? 0.8 : 0, // 09:00–11:00 London: 2.4 mm in the working day
      code: h === 11 ? 'lightrain_day' : 'cloudy',
    }));
    const [day] = summariseForecast(series(slots), NOW);
    expect(day).toMatchObject({ date: '2026-10-02', symbol: 'drizzle', label: 'Light rain', highC: 14, lowC: 8, rainMm: 2.4, wet: true });
  });

  it('ignores rain outside the working day', () => {
    const slots = hourly('2026-10-02', 0, 23, (h) => ({ rain1: h >= 18 || h < 5 ? 3 : 0 })); // night and evening only
    const [day] = summariseForecast(series(slots), NOW);
    expect(day?.rainMm).toBe(0);
    expect(day?.wet).toBe(false);
  });

  it('counts the 6-hourly entries that cover the working day, once', () => {
    const slots: Slot[] = ['00', '06', '12', '18'].map((h) => ({ time: `2026-10-06T${h}:00:00Z`, temp: 11, rain6: 1.5, code: 'rain' }));
    const [day] = summariseForecast(series(slots), NOW);
    // 06Z (07:00 BST) and 12Z (13:00 BST) count; 00Z and 18Z (19:00 BST) don't.
    expect(day?.rainMm).toBe(3);
    expect(day?.symbol).toBe('rain');
  });

  it('puts a late-UTC hour on the next London day during BST', () => {
    const slots = [
      ...hourly('2026-10-02', 0, 22, () => ({})),
      { time: '2026-10-02T23:00:00Z', temp: 9, rain1: 0 }, // 00:00 on 3 Oct in London
      ...hourly('2026-10-03', 0, 22, () => ({})),
    ];
    expect(summariseForecast(series(slots), NOW).map((d) => d.date)).toEqual(['2026-10-02', '2026-10-03']);
  });

  it('drops the clipped last day and days outside today + 8', () => {
    const slots = [
      ...hourly('2026-10-02', 0, 23, () => ({})),
      ...hourly('2026-10-03', 0, 1, () => ({})), // only two entries
      ...hourly('2026-10-12', 0, 23, () => ({})), // beyond today + 8
      ...hourly('2026-09-30', 0, 23, () => ({})), // yesterday
    ];
    expect(summariseForecast(series(slots), NOW).map((d) => d.date)).toEqual(['2026-10-02']);
  });

  it('returns [] for empty or odd data instead of throwing', () => {
    expect(summariseForecast(null)).toEqual([]);
    expect(summariseForecast({})).toEqual([]);
    expect(summariseForecast({ properties: { timeseries: 'nope' } })).toEqual([]);
    expect(summariseForecast({ properties: { timeseries: [null, 5, { time: 'x' }] } })).toEqual([]);
  });
});
