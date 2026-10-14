/** '12 Oct' or '12–14 Oct' or '30 Oct – 2 Nov' from two YYYY-MM-DD dates. */
export function formatRange(from: string, to: string): string {
  const parse = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  };
  const a = parse(from);
  const b = parse(to);
  const day = (dt: Date) => String(dt.getUTCDate());
  const month = (dt: Date) => new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(dt);
  if (from === to) return `${day(a)} ${month(a)}`;
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) return `${day(a)}–${day(b)} ${month(a)}`;
  return `${day(a)} ${month(a)} – ${day(b)} ${month(b)}`;
}

/** 'Mon 6 Oct' from a YYYY-MM-DD date. */
export function formatDayShort(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)),
  );
}
