'use client';

import { useRouter } from 'next/navigation';
import type { LanePerson } from '@/lib/rounds/lanes';

/**
 * "Whose work am I looking at": Everyone, You, or one lead. Lives in the URL (?person=) so a link or a refresh keeps it,
 * and keeps the view and date you were on.
 */
export function PersonFilter({
  view,
  date,
  value,
  people,
}: {
  view: 'week' | 'month';
  date: string;
  value: string | 'all' | 'mine';
  people: ReadonlyArray<LanePerson>;
}) {
  const router = useRouter();
  const leads = people.filter((p) => !p.isOwner);
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Person</span>
      <select
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          router.push(`/calendar?view=${view}&date=${date}${next === 'all' ? '' : `&person=${next}`}`);
        }}
        className="h-9 rounded-full border border-input bg-card px-3 text-sm font-medium focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-label="Show whose work"
      >
        <option value="all">Everyone</option>
        <option value="mine">You</option>
        {leads.map((p) => (
          <option key={p.workerId} value={p.workerId}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
