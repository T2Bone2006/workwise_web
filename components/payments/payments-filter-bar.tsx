'use client';

import type { ReactNode } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { JobsDateRangeFilter } from '@/components/jobs/jobs-date-range-filter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';

export type PaymentsWhere = { id: string; field: string | null; value: string | null };

export type PaymentsFilterField = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

const MAX_FILTERS = 4;

export function newPaymentsWhere(): PaymentsWhere {
  return { id: Math.random().toString(36).slice(2), field: null, value: null };
}

export function PaymentsListFilters({
  search,
  onSearch,
  searchPlaceholder,
  dateLabel,
  dateFrom,
  dateTo,
  onDateChange,
  fields,
  wheres,
  onWheresChange,
  onClear,
  hasFilters,
}: {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  dateLabel: string;
  dateFrom?: string;
  dateTo?: string;
  onDateChange: (range: { date_from?: string; date_to?: string }) => void;
  fields: PaymentsFilterField[];
  wheres: PaymentsWhere[];
  onWheresChange: (next: PaymentsWhere[]) => void;
  onClear: () => void;
  hasFilters: boolean;
}) {
  // "Clear filters" sits on the first filter line once there is one, otherwise up with the search.
  const clearButton = hasFilters ? (
    <Button variant="ghost" size="sm" className="ml-auto h-10 self-end" onClick={onClear}>
      Clear filters
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[180px] flex-1 flex-col gap-1.5 sm:max-w-[280px]">
          <label className="text-xs font-medium text-muted-foreground">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              className="pl-9 pr-9"
              aria-label={searchPlaceholder}
            />
            {search.length > 0 ? (
              <button
                type="button"
                onClick={() => onSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-[200px] max-w-[min(100%,280px)] flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{dateLabel}</label>
          <JobsDateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={onDateChange} />
        </div>
        {wheres.length < MAX_FILTERS ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 gap-1.5 self-end"
            onClick={() => onWheresChange([...wheres, newPaymentsWhere()])}
          >
            <Plus className="size-3.5" />
            Filter
          </Button>
        ) : null}
        {wheres.length === 0 ? clearButton : null}
      </div>
      {wheres.length > 0 ? (
        <WhereRows fields={fields} wheres={wheres} onWheresChange={onWheresChange} clearButton={clearButton} />
      ) : null}
    </div>
  );
}

function WhereRows({
  fields,
  wheres,
  onWheresChange,
  clearButton,
}: {
  fields: PaymentsFilterField[];
  wheres: PaymentsWhere[];
  onWheresChange: (next: PaymentsWhere[]) => void;
  clearButton: ReactNode;
}) {
  const list = wheres;

  const update = (id: string, patch: Partial<PaymentsWhere>) => {
    onWheresChange(list.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  return (
    <div className="space-y-2 border-t border-border/60 pt-3">
      {list.map((row, index) => {
        const field = fields.find((item) => item.key === row.field);
        return (
          <div key={row.id} className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-[160px] max-w-[min(100%,240px)] flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {index === 0 ? 'Where' : 'And'}
              </label>
              <SearchableSelect
                value={row.field ?? '__none__'}
                onValueChange={(value) => {
                  update(row.id, { field: value === '__none__' ? null : value, value: null });
                }}
                placeholder="Choose field"
                searchPlaceholder="Search fields…"
                className="h-10 w-full"
                options={[
                  { value: '__none__', label: 'Any field' },
                  ...fields.map((item) => ({ value: item.key, label: item.label })),
                ]}
              />
            </div>
            <div className="flex min-w-[160px] max-w-[min(100%,240px)] flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Is</label>
              <SearchableSelect
                value={row.value ?? '__none__'}
                onValueChange={(value) => {
                  update(row.id, { value: value === '__none__' ? null : value });
                }}
                placeholder={row.field ? 'Choose value' : 'Pick a field first'}
                searchPlaceholder="Search values…"
                className="h-10 w-full"
                disabled={!row.field}
                options={[
                  { value: '__none__', label: 'Any value' },
                  ...(field?.options ?? []),
                ]}
              />
            </div>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 px-2 text-muted-foreground"
                onClick={() => {
                  onWheresChange(list.filter((item) => item.id !== row.id));
                }}
                aria-label="Remove filter"
              >
                <X className="size-4" />
              </Button>
            {index === 0 ? clearButton : null}
          </div>
        );
      })}
    </div>
  );
}
