import { endOfMonth, isValidYmd, todayInLondon, type Ymd } from '@/lib/rounds/dates';

export type Period =
  | { kind: 'month'; year: number; month: number } // month 1..12
  | { kind: 'tax_year'; startYear: number }; // 2026 = 6 Apr 2026 – 5 Apr 2027

/** Inclusive at both ends. */
export type PeriodRange = { from: Ymd; to: Ymd; label: string };

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(year: number, month: number, day: number): Ymd {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** '2026-04-05' → 2025; '2026-04-06' → 2026. */
export function taxYearFor(date: Ymd): number {
  const year = Number(date.slice(0, 4));
  return date >= ymd(year, 4, 6) ? year : year - 1;
}

export function periodRange(p: Period): PeriodRange {
  if (p.kind === 'tax_year') {
    const short = String((p.startYear + 1) % 100).padStart(2, '0');
    return {
      from: ymd(p.startYear, 4, 6),
      to: ymd(p.startYear + 1, 4, 5),
      label: `${p.startYear}/${short} tax year`,
    };
  }
  const first = ymd(p.year, p.month, 1);
  return {
    from: first,
    to: endOfMonth(first),
    label: `${MONTH_NAMES[p.month - 1]} ${p.year}`,
  };
}

/** April … March, 12 items. */
export function monthsInTaxYear(startYear: number): Array<{ year: number; month: number }> {
  return Array.from({ length: 12 }, (_, i) => {
    const month = ((3 + i) % 12) + 1;
    return { year: month >= 4 ? startYear : startYear + 1, month };
  });
}

export function currentMonth(today: Ymd = todayInLondon()): Period {
  return { kind: 'month', year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
}

export function currentTaxYear(today: Ymd = todayInLondon()): Period {
  return { kind: 'tax_year', startYear: taxYearFor(today) };
}

/** 'm-2027-03' → month; 'ty-2026' → tax year; anything else → this month. Never throws. */
export function parsePeriodParam(raw: string | undefined, today: Ymd = todayInLondon()): Period {
  if (raw) {
    const month = /^m-(\d{4})-(\d{2})$/.exec(raw);
    if (month) {
      const year = Number(month[1]);
      const m = Number(month[2]);
      if (m >= 1 && m <= 12 && isValidYmd(ymd(year, m, 1))) {
        return { kind: 'month', year, month: m };
      }
    }
    const taxYear = /^ty-(\d{4})$/.exec(raw);
    if (taxYear) return { kind: 'tax_year', startYear: Number(taxYear[1]) };
  }
  return currentMonth(today);
}

/** Inverse of parsePeriodParam. */
export function periodParam(p: Period): string {
  return p.kind === 'tax_year' ? `ty-${p.startYear}` : `m-${p.year}-${pad2(p.month)}`;
}

/** London calendar date of a timestamptz ISO string (for payments.received_at). */
export function londonDateOf(iso: string): Ymd {
  return todayInLondon(new Date(iso));
}
