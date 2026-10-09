import { formatGbp } from '@/lib/money/pence';
import { addDays, diffDays, isValidYmd, type Ymd } from '@/lib/rounds/dates';
import { frequencyLabel } from '@/lib/rounds/parse-frequency';
import { formatBoardDay } from '@/lib/rounds/week-board';

export const pounds = (n: number | null | undefined): string => formatGbp(n ?? 0);

/** "Thu 8 Oct". */
export const dayLabel = (ymd: Ymd): string => formatBoardDay(ymd);

/** "today", "tomorrow", "yesterday", else "Thu 8 Oct". */
export function friendlyDay(ymd: Ymd, today: Ymd): string {
  if (ymd === today) return 'today';
  if (ymd === addDays(today, 1)) return 'tomorrow';
  if (ymd === addDays(today, -1)) return 'yesterday';
  return dayLabel(ymd);
}

export function oftenLabel(frequencyDays: number): string {
  return frequencyLabel(frequencyDays);
}

export function asText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export function asNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function asYmd(v: unknown): Ymd | null {
  if (typeof v !== 'string' || v.length < 10) return null;
  const s = v.slice(0, 10);
  return isValidYmd(s) ? s : null;
}

export function daysAgo(ymd: Ymd, today: Ymd): number {
  return diffDays(ymd, today);
}

/** Removes characters PostgREST treats as syntax inside an or() filter. */
export function searchTerm(raw: string): string {
  return raw.replace(/[,()%*\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
