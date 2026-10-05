'use client';

import { useRouter } from 'next/navigation';
import { IconChip, Tag } from '@/components/look';
import { formatDayLong, methodIcon, methodTone } from '@/components/payments/method-style';
import type { PaymentHistoryRow } from '@/lib/data/payments/history';
import { formatGbp } from '@/lib/money/pence';
import { paymentMethodLabel } from '@/lib/payments/method-labels';
import { addDays } from '@/lib/rounds/dates';

function dayHeading(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return formatDayLong(day);
}

/** Payments grouped by the day they arrived, each day with its total, so a week of money reads in seconds. */
export function PaymentFeed({ rows, today }: { rows: PaymentHistoryRow[]; today: string }) {
  const router = useRouter();
  const days: { day: string; rows: PaymentHistoryRow[]; total: number }[] = [];
  for (const row of rows) {
    const day = row.receivedAt.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === day) {
      last.rows.push(row);
      last.total += row.amount;
    } else {
      days.push({ day, rows: [row], total: row.amount });
    }
  }

  return (
    <div className="space-y-4">
      {days.map((group) => (
        <section key={group.day}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <h3 className="font-semibold text-foreground">{dayHeading(group.day, today)}</h3>
            <span className="text-muted-foreground tabular-nums">
              {group.rows.length === 1 ? '1 payment' : `${group.rows.length} payments`} ·{' '}
              <span className="font-medium text-(--tone-emerald-text)">{formatGbp(group.total)}</span>
            </span>
          </div>
          <ul className="-mx-4 divide-y divide-border sm:-mx-5">
            {group.rows.map((row) => (
              <li key={row.id} className="relative flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 has-[:focus-visible]:bg-muted/50 sm:px-5">
                <button
                  type="button"
                  aria-label={`Open ${row.customerName}`}
                  onClick={() => router.push(`/customers/${row.customerId}`)}
                  className="absolute inset-0 rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                />
                <span className="pointer-events-none">
                  <IconChip icon={methodIcon(row.method)} tone={methodTone(row.method)} />
                </span>
                <span className="pointer-events-none min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium tracking-tight">{row.customerName}</span>
                  <span className="mt-0.5 block">
                    <Tag tone={methodTone(row.method)}>{paymentMethodLabel(row.method)}</Tag>
                  </span>
                </span>
                <span className="pointer-events-none text-base font-semibold text-(--tone-emerald-solid) tabular-nums">
                  +{formatGbp(row.amount)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
