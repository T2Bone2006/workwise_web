'use client';

import { SlidersHorizontal } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { plural } from '@/components/rounds/overview/shared';

export type ImportDefaultsState = {
  /** Weeks, as typed. */
  frequencyWeeks: string;
  /** Pounds, as typed. */
  price: string;
  /** YYYY-MM-DD, or ''. */
  startDate: string;
};

export const EMPTY_DEFAULTS: ImportDefaultsState = { frequencyWeeks: '', price: '', startDate: '' };

/**
 * "If a row is missing something…" The three fallbacks, with how many rows each
 * one would rescue, so it is clear when they matter. Nothing is assumed: all
 * three start empty and a missing value stays red until one is set.
 */
export function ImportDefaults({
  value,
  onChange,
  missingFrequency,
  missingPrice,
  missingStart,
}: {
  value: ImportDefaultsState;
  onChange: (next: ImportDefaultsState) => void;
  missingFrequency: number;
  missingPrice: number;
  missingStart: number;
}) {
  const field = 'h-8 w-20 text-sm';
  return (
    <Card className="glass-card gap-4 p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-300">
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold">If a row is missing something</p>
          <p className="text-xs text-muted-foreground">
            We never guess. Set a fallback here and it fills every row that has a gap.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-2">
          <span className="block text-sm font-medium">No frequency?</span>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            Every
            <Input
              inputMode="numeric"
              placeholder="4"
              value={value.frequencyWeeks}
              onChange={(e) => onChange({ ...value, frequencyWeeks: e.target.value.replace(/[^\d]/g, '').slice(0, 2) })}
              className={field}
              aria-label="Default weeks between visits"
            />
            weeks
          </span>
          <Count n={missingFrequency} what="without one" />
        </label>

        <label className="space-y-2">
          <span className="block text-sm font-medium">No price?</span>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            £
            <Input
              inputMode="decimal"
              placeholder="12"
              value={value.price}
              onChange={(e) => onChange({ ...value, price: e.target.value.replace(/[^\d.]/g, '').slice(0, 7) })}
              className={field}
              aria-label="Default price per visit"
            />
          </span>
          <Count n={missingPrice} what="without one" />
        </label>

        <label className="space-y-2">
          <span className="block text-sm font-medium">No next date?</span>
          <Input
            type="date"
            value={value.startDate}
            onChange={(e) => onChange({ ...value, startDate: e.target.value })}
            className="h-8 w-full text-sm"
            aria-label="Default first visit date"
          />
          <Count n={missingStart} what="have no date (start today if blank)" />
        </label>
      </div>
    </Card>
  );
}

function Count({ n, what }: { n: number; what: string }) {
  return (
    <span className="block text-xs text-muted-foreground">
      {n === 0 ? 'Every row has one' : `${plural(n, 'row', 'rows')} ${what}`}
    </span>
  );
}
