'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendMonth } from '@/lib/books/trend';
import { formatGbp } from '@/lib/money/pence';

const IN = 'var(--tone-emerald-solid)';
const OUT = 'var(--tone-rose-solid)';

/** Money in against money out for the last six months, the current month last. */
export function MoneyChart({ months }: { months: TrendMonth[] }) {
  return (
    <div className="h-48 text-muted-foreground" role="img" aria-label={months.map((m) => `${m.label}: ${formatGbp(m.moneyIn)} in, ${formatGbp(m.moneyOut)} out`).join('; ')}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={months} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={3}>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} axisLine={false} />
          <YAxis
            width={48}
            tick={{ fontSize: 11, fill: 'currentColor' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => `£${value >= 1000 ? `${Math.round(value / 100) / 10}k` : value}`}
          />
          <Tooltip
            cursor={{ fill: 'currentColor', fillOpacity: 0.06 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const value = (key: string) => Number(payload.find((item) => item.dataKey === key)?.value ?? 0);
              return (
                <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
                  <p className="font-medium">{label}</p>
                  <p className="text-(--tone-emerald-text)">In {formatGbp(value('moneyIn'))}</p>
                  <p className="text-(--tone-rose-text)">Out {formatGbp(value('moneyOut'))}</p>
                  <p>Left {formatGbp(value('moneyIn') - value('moneyOut'))}</p>
                </div>
              );
            }}
          />
          <Bar dataKey="moneyIn" name="Money in" fill={IN} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="moneyOut" name="Money out" fill={OUT} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
