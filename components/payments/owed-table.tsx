'use client';

import { useState } from 'react';
import { CircleCheck, SearchX } from 'lucide-react';
import { EmptyState, LookCard } from '@/components/look';
import { ChaseList } from '@/components/payments/chase-list';
import { FilterChips, type FilterChip } from '@/components/payments/filter-chips';
import {
  PaymentsListFilters,
  type PaymentsWhere,
} from '@/components/payments/payments-filter-bar';
import { owedBandOf, summariseOwedBands, type OwedBand } from '@/components/payments/owed-age';
import type { OwedCustomerRow } from '@/lib/data/payments/owed';
import { formatGbp } from '@/lib/money/pence';

export function OwedTable({
  rows,
  today,
  initialBand = 'all',
}: {
  rows: OwedCustomerRow[];
  today: string;
  initialBand?: OwedBand | 'all';
}) {
  const [band, setBand] = useState<OwedBand | 'all'>(initialBand);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string | undefined>();
  const [dateTo, setDateTo] = useState<string | undefined>();
  const [wheres, setWheres] = useState<PaymentsWhere[]>([]);
  const needle = search.trim().toLowerCase();
  const owingAll = rows.filter((row) => row.owedAmount > 0);
  const owing = owingAll.filter((row) => {
    if (band !== 'all' && owedBandOf(row.oldestUnpaidDate, today) !== band) return false;
    if (needle) {
      const haystack = [row.name, row.phone, row.email].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    const since = row.oldestUnpaidDate?.slice(0, 10) ?? '';
    if (dateFrom && (!since || since < dateFrom)) return false;
    if (dateTo && (!since || since > dateTo)) return false;
    for (const where of wheres) {
      if (!where.field || !where.value) continue;
      if (where.field === 'customer' && row.name !== where.value) return false;
      if (where.field === 'visits' && String(row.unpaidVisitCount) !== where.value) return false;
    }
    return true;
  });
  const customerOptions = [...new Set(owingAll.map((row) => row.name))].sort().map((name) => ({
    value: name,
    label: name,
  }));
  const visitOptions = [...new Set(owingAll.map((row) => row.unpaidVisitCount))]
    .sort((a, b) => a - b)
    .map((count) => ({
      value: String(count),
      label: count === 1 ? '1 visit' : `${count} visits`,
    }));
  const whereActive = wheres.some((where) => where.field && where.value);

  const filters = (
    <PaymentsListFilters
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Name, phone, email…"
      dateLabel="Owed since"
      dateFrom={dateFrom}
      dateTo={dateTo}
      onDateChange={({ date_from, date_to }) => {
        setDateFrom(date_from);
        setDateTo(date_to);
      }}
      fields={[
        { key: 'customer', label: 'Customer', options: customerOptions },
        { key: 'visits', label: 'Visits', options: visitOptions },
      ]}
      wheres={wheres}
      onWheresChange={setWheres}
      hasFilters={needle.length > 0 || Boolean(dateFrom || dateTo) || whereActive}
      onClear={() => {
        setSearch('');
        setDateFrom(undefined);
        setDateTo(undefined);
        setWheres([]);
      }}
    />
  );

  if (owingAll.length === 0) {
    return (
      <EmptyState
        icon={CircleCheck}
        title="Nobody owes you anything"
        body="Every finished visit is paid for. New ones show up here as soon as they are done and not paid."
      />
    );
  }

  const totalOwed = owingAll.reduce((sum, row) => sum + row.owedAmount, 0);
  const summary = summariseOwedBands(owingAll, today);
  const customers = (n: number) => (n === 1 ? '1 customer' : `${n} customers`);
  const chips: FilterChip<OwedBand | 'all'>[] = [
    { key: 'all', label: 'Everyone owing', detail: `${formatGbp(totalOwed)} · ${customers(owingAll.length)}` },
    ...summary.map((item) => ({
      key: item.key,
      label: item.label,
      tone: item.tone,
      detail: `${formatGbp(item.amount)} · ${customers(item.count)}`,
    })),
  ];

  return (
    <div className="space-y-4">
      <FilterChips
        ariaLabel="How long they have waited"
        chips={chips}
        value={band}
        onChange={(key) => setBand(key === band ? 'all' : key)}
      />
      {filters}
      {owing.length === 0 ? (
        <EmptyState icon={SearchX} title="Nothing matches" body="Try a different name or clear the filters." />
      ) : (
        <LookCard>
          <ChaseList rows={owing} today={today} />
        </LookCard>
      )}
    </div>
  );
}
