/** ISO weekdays: 1 = Monday … 7 = Sunday. */
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

function clean(days: ReadonlyArray<number>): number[] {
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
}

/** 'Mon–Fri', 'Mon, Wed, Fri', 'Every day', 'No usual days'. A run of three or more in a row becomes a range. */
export function usualDaysLabel(input: ReadonlyArray<number>): string {
  const days = clean(input);
  if (days.length === 0) return 'No usual days';
  if (days.length === 7) return 'Every day';

  const parts: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j]! + 1) j += 1;
    const run = j - i + 1;
    if (run >= 3) {
      parts.push(`${DAY_SHORT[days[i]! - 1]}–${DAY_SHORT[days[j]! - 1]}`);
    } else {
      for (let k = i; k <= j; k += 1) parts.push(DAY_SHORT[days[k]! - 1]!);
    }
    i = j + 1;
  }
  return parts.join(', ');
}
