import { format } from 'date-fns';

export function formatJobDay(ymd: string): string {
  return format(new Date(`${ymd.slice(0, 10)}T00:00:00`), 'EEEE d MMMM');
}

export function formatJobTime(hm: string): string {
  const [hourText, minuteText] = hm.slice(0, 5).split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return hm;
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? 'am' : 'pm';
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** Short line for a card: "Thu 9 Oct · 2:30 pm". */
export function formatJobWhenShort(ymd: string, hm: string | null): string {
  const day = format(new Date(`${ymd.slice(0, 10)}T00:00:00`), 'EEE d MMM');
  return hm ? `${day} · ${formatJobTime(hm)}` : day;
}
