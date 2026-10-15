import { Tag, type Tone } from '@/components/look';
import { diffDays } from '@/lib/rounds/dates';

/** How long money has been owed, as words and a colour: quiet under a week, amber to four weeks, then rose. */
export function owedAge(oldest: string | null, today: string): { days: number; label: string; tone: Tone } | null {
  if (!oldest) return null;
  const days = diffDays(oldest.slice(0, 10), today);
  if (days < 0) return null;
  const label = days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`;
  const tone: Tone = days >= 28 ? 'rose' : days >= 7 ? 'amber' : 'slate';
  return { days, label, tone };
}

export function OwedAgeTag({ oldest, today }: { oldest: string | null; today: string }) {
  const age = owedAge(oldest, today);
  if (!age) return null;
  return <Tag tone={age.tone}>{age.label}</Tag>;
}

export type OwedBand = 'old' | 'mid' | 'new';

/** The three groups the "how long they've waited" bar and filter use. Same cut-offs as the age tags. */
export const OWED_BANDS: { key: OwedBand; label: string; tone: Tone }[] = [
  { key: 'old', label: '4 weeks or more', tone: 'rose' },
  { key: 'mid', label: '1 to 4 weeks', tone: 'amber' },
  { key: 'new', label: 'Under a week', tone: 'slate' },
];

export function owedBandOf(oldest: string | null, today: string): OwedBand {
  const age = owedAge(oldest, today);
  if (!age || age.days < 7) return 'new';
  return age.days >= 28 ? 'old' : 'mid';
}

export type OwedBandSummary = { key: OwedBand; label: string; tone: Tone; count: number; amount: number };

/** Customers and money in each waiting group, longest wait first. */
export function summariseOwedBands(
  rows: { owedAmount: number; oldestUnpaidDate: string | null }[],
  today: string,
): OwedBandSummary[] {
  return OWED_BANDS.map((band) => {
    const inBand = rows.filter(
      (row) => row.owedAmount > 0 && owedBandOf(row.oldestUnpaidDate, today) === band.key,
    );
    return {
      ...band,
      count: inBand.length,
      amount: inBand.reduce((sum, row) => sum + row.owedAmount, 0),
    };
  });
}
