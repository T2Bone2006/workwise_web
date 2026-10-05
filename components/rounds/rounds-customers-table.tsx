'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Eye,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Upload,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  deactivateCustomer,
  reactivateCustomer,
} from '@/lib/actions/customers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, EmptyState, Tag } from '@/components/look';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FloatingAddButton } from '@/components/ui/floating-add-button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { SearchableMultiSelect } from '@/components/ui/searchable-multi-select';
import type { RoundsCustomerListRow } from '@/lib/data/rounds/customers';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';
import { postcodeMatchesArea, ukPostcodeOutward } from '@/lib/utils/postcode';
import { cn } from '@/lib/utils';
import { formatGbp } from '@/lib/money/pence';

const DEBOUNCE_MS = 300;

type StatusFilter = 'active' | 'inactive' | 'all';
export type CustomerFilterField = 'service' | 'postcode' | 'payment' | 'frequency';
export type CustomerFieldFilter = { field: CustomerFilterField; value: string };

const FILTER_FIELDS: { key: CustomerFilterField; label: string }[] = [
  { key: 'service', label: 'Service' },
  { key: 'postcode', label: 'Postcode' },
  { key: 'payment', label: 'Payment' },
  { key: 'frequency', label: 'How often' },
];

const MAX_FILTERS = 4;

type FilterRow = {
  id: string;
  field: CustomerFilterField | null;
  value: string;
};

function newFilterId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function newFilterRow(filter?: CustomerFieldFilter): FilterRow {
  return {
    id: newFilterId(),
    field: filter?.field ?? null,
    value: filter?.value ?? '',
  };
}

/** Rows with both a field and a value. Blank rows stay on screen but do not filter. */
function committedFilters(rows: FilterRow[]): CustomerFieldFilter[] {
  const committed: CustomerFieldFilter[] = [];
  for (const row of rows) {
    if (row.field && row.value) committed.push({ field: row.field, value: row.value });
  }
  return committed;
}
type WhenFilter = 'overdue' | 'week' | 'later' | 'none';

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  utc.setUTCDate(utc.getUTCDate() + days);
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function paymentLabel(terms: RoundsCustomerListRow['payment_terms']): string {
  return terms === 'invoice' ? 'Invoice' : '—';
}

function valuesForField(
  customers: RoundsCustomerListRow[],
  field: CustomerFilterField,
): string[] {
  const values = new Set<string>();
  for (const customer of customers) {
    if (field === 'service') customer.services.forEach((value) => values.add(value));
    if (field === 'postcode') {
      customer.postcodes.forEach((value) => {
        const outward = ukPostcodeOutward(value);
        if (outward) values.add(outward);
      });
    }
    if (field === 'frequency') customer.frequencies.forEach((value) => values.add(value));
    if (field === 'payment') values.add(paymentLabel(customer.payment_terms));
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'en-GB'));
}

function splitPostcodeAreas(value: string): string[] {
  const seen = new Set<string>();
  for (const part of value.split(',')) {
    const area = part.trim().toUpperCase().replace(/\s+/g, ' ');
    if (area) seen.add(area);
  }
  return [...seen];
}

function postcodeFilterMatches(postcodes: string[], value: string): boolean {
  const areas = splitPostcodeAreas(value);
  if (areas.length === 0) return true;
  return postcodes.some((postcode) => areas.some((area) => postcodeMatchesArea(postcode, area)));
}

function matchesFieldFilters(
  customer: RoundsCustomerListRow,
  filters: CustomerFieldFilter[],
): boolean {
  return filters.every((filter) => {
    if (!filter.value) return true;
    if (filter.field === 'service') return customer.services.includes(filter.value);
    if (filter.field === 'postcode') return postcodeFilterMatches(customer.postcodes, filter.value);
    if (filter.field === 'frequency') return customer.frequencies.includes(filter.value);
    return paymentLabel(customer.payment_terms) === filter.value;
  });
}

function whenOf(date: string | null, today: string): WhenFilter {
  if (!date) return 'none';
  if (date < today) return 'overdue';
  if (date <= addDays(today, 6)) return 'week';
  return 'later';
}

function formatVisitDate(ymd: string | null): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

function phoneLabel(customer: RoundsCustomerListRow): string {
  return (
    formatUkPhoneDisplay(customer.phone_e164) ||
    customer.phone?.trim() ||
    '—'
  );
}

function RowMenu({
  customer,
  onAction,
}: {
  customer: RoundsCustomerListRow;
  onAction: (customer: RoundsCustomerListRow, action: 'deactivate' | 'reactivate') => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${customer.name}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/customers/${customer.id}`} className="gap-2">
            <Eye className="size-3.5" />
            View
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/customers/${customer.id}/edit`} className="gap-2">
            <Pencil className="size-3.5" />
            Edit
          </Link>
        </DropdownMenuItem>
        {customer.is_active ? (
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onAction(customer, 'deactivate')}>
            <UserMinus className="size-3.5" />
            Deactivate
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onAction(customer, 'reactivate')}>
            <UserCheck className="size-3.5" />
            Reactivate
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function firstOf(values: string[]): string {
  return values[0] ?? '—';
}

/** First service, then how many more ("Window clean (front) +1"). */
function servicesLabel(customer: RoundsCustomerListRow): string {
  const [first, ...rest] = customer.services;
  if (!first) return 'No active agreement';
  return rest.length > 0 ? `${first} +${rest.length}` : first;
}

function NextVisit({ date, today }: { date: string | null; today: string }) {
  const when = whenOf(date, today);
  if (when === 'none') return <span className="text-sm text-muted-foreground">No visit booked</span>;
  const tone = when === 'overdue' ? 'amber' : when === 'week' ? 'sky' : 'slate';
  return <Tag tone={tone}>{when === 'overdue' ? `Overdue · ${formatVisitDate(date)}` : formatVisitDate(date)}</Tag>;
}

export function RoundsCustomersTable({
  customers,
  today,
  initialSearch = '',
  initialStatus = 'active',
  initialFilters = [],
  fetchError = null,
}: {
  customers: RoundsCustomerListRow[];
  today: string;
  initialSearch?: string;
  initialStatus?: StatusFilter;
  initialFilters?: CustomerFieldFilter[];
  fetchError?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [filterRows, setFilterRows] = useState<FilterRow[]>(() =>
    initialFilters.map((filter) => newFilterRow(filter)),
  );
  const filterRowsRef = useRef(filterRows);
  filterRowsRef.current = filterRows;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<RoundsCustomerListRow | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<'deactivate' | 'reactivate'>(
    'deactivate',
  );
  const [isPending, setIsPending] = useState(false);
  const [moneyFilter, setMoneyFilter] = useState<'overdue' | 'paid' | null>(null);

  const pushFilters = useCallback(
    (
      nextSearch: string,
      nextStatus: StatusFilter,
      nextFields: CustomerFieldFilter[],
    ) => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = nextSearch.trim();
      if (trimmed) params.set('search', trimmed);
      else params.delete('search');
      if (nextStatus === 'active') params.delete('status');
      else params.set('status', nextStatus);
      params.delete('when');
      for (let i = 0; i < MAX_FILTERS; i += 1) {
        params.delete(`f${i}`);
        params.delete(`v${i}`);
      }
      nextFields.forEach((filter, index) => {
        params.set(`f${index}`, filter.field);
        params.set(`v${index}`, filter.value);
      });
      const qs = params.toString();
      router.push(qs ? `/customers?${qs}` : '/customers');
    },
    [router, searchParams],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushFilters(value, status, committedFilters(filterRowsRef.current));
    }, DEBOUNCE_MS);
  };

  const onStatusChange = (value: string) => {
    const next = (value === 'inactive' || value === 'all' ? value : 'active') as StatusFilter;
    setStatus(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushFilters(search, next, committedFilters(filterRows));
  };

  const openConfirm = (
    customer: RoundsCustomerListRow,
    action: 'deactivate' | 'reactivate',
  ) => {
    setConfirmAction(action);
    setConfirmTarget(customer);
  };

  const handleConfirm = async () => {
    if (!confirmTarget) return;
    setIsPending(true);
    const result =
      confirmAction === 'deactivate'
        ? await deactivateCustomer(confirmTarget.id)
        : await reactivateCustomer(confirmTarget.id);
    setIsPending(false);
    setConfirmTarget(null);
    if (result.success) {
      toast.success(
        confirmAction === 'deactivate'
          ? 'Customer deactivated'
          : 'Customer reactivated',
      );
      router.refresh();
    } else {
      toast.error(
        result.error ??
          (confirmAction === 'deactivate'
            ? 'Failed to deactivate'
            : 'Failed to reactivate'),
      );
    }
  };

  const appliedFilters = committedFilters(filterRows);
  const narrowed = customers.filter((customer) => {
    if (!matchesFieldFilters(customer, appliedFilters)) return false;
    if (moneyFilter === 'overdue') return customer.owed_amount > 0;
    if (moneyFilter === 'paid') return customer.owed_amount <= 0;
    return true;
  });
  const visible = narrowed;
  const overdueCustomers = customers.filter((customer) => customer.owed_amount > 0);
  const paidCustomers = customers.filter((customer) => customer.owed_amount <= 0);
  const overdueTotal = overdueCustomers.reduce((sum, customer) => sum + customer.owed_amount, 0);
  const moneyPills: { key: 'overdue' | 'paid' | null; label: string; count: number; extra?: string }[] = [
    { key: null, label: 'Everyone', count: customers.length },
    { key: 'overdue', label: 'Owes', count: overdueCustomers.length, extra: formatGbp(overdueTotal) },
    { key: 'paid', label: 'Paid up', count: paidCustomers.length },
  ];
  const showWhereRows = filterRows.length > 0;
  // "Clear filters" sits on the first filter line once there is one, otherwise up with the search.
  const clearButton =
    search.trim() || status !== 'active' || filterRows.length > 0 || moneyFilter != null ? (
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-10"
        onClick={() => {
          setSearch('');
          setStatus('active');
          setFilterRows([]);
          setMoneyFilter(null);
          router.push('/customers');
        }}
      >
        Clear filters
      </Button>
    ) : null;
  const emptyBecauseFilter =
    visible.length === 0 &&
    (search.trim().length > 0 ||
      status !== 'active' ||
      appliedFilters.length > 0 ||
      moneyFilter != null);

  const updateFilterRow = (id: string, patch: Partial<Pick<FilterRow, 'field' | 'value'>>) => {
    const next = filterRows.map((row) => (row.id === id ? { ...row, ...patch } : row));
    setFilterRows(next);
    pushFilters(search, status, committedFilters(next));
  };

  return (
    <>
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow)">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[180px] flex-1 flex-col gap-1.5 sm:max-w-[320px]">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="customer-search">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="customer-search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Name, phone, email…"
                className="pl-9"
                aria-label="Search customers"
              />
            </div>
          </div>
          <div className="flex min-w-[10.5rem] flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Customer</label>
            <Select value={status} onValueChange={onStatusChange}>
              <SelectTrigger className="w-[10.5rem]" aria-label="Status filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Money</span>
            <div className="flex w-full rounded-full bg-look-segment p-1 text-sm font-medium sm:w-auto" role="group" aria-label="Filter by money">
              {moneyPills.map((pill) => (
                <button
                  key={pill.label}
                  type="button"
                  aria-pressed={moneyFilter === pill.key}
                  onClick={() => setMoneyFilter(pill.key)}
                  className={cn(
                    'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:flex-none sm:px-3.5',
                    moneyFilter === pill.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {pill.label}
                  <span className={cn('tabular-nums', pill.key === 'overdue' && pill.count > 0 ? 'text-(--tone-rose-text)' : 'text-muted-foreground')}>
                    {pill.extra && pill.count > 0 ? (
                      <>
                        <span className="sm:hidden">{pill.count}</span>
                        <span className="hidden sm:inline">{pill.extra}</span>
                      </>
                    ) : (
                      pill.count
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {filterRows.length === 0 ? (
            <Button
              type="button"
              variant="outline"
              className="h-10 gap-1.5"
              onClick={() => setFilterRows([newFilterRow()])}
            >
              <Plus className="size-3.5" />
              Filter by service, postcode…
            </Button>
          ) : null}
          {showWhereRows ? null : clearButton}
        </div>
        {showWhereRows ? (
          <div className="space-y-2 border-t border-border/60 pt-3">
              {filterRows.map((row, index) => {
                const field = row.field;
                const options = field ? valuesForField(customers, field) : [];
                return (
                  <div key={row.id} className="flex flex-wrap items-end gap-3">
                    <div className="flex min-w-[160px] max-w-[min(100%,240px)] flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        {index === 0 ? 'Where' : 'And'}
                      </label>
                      <SearchableSelect
                        value={field ?? '__none__'}
                        onValueChange={(value) => {
                          const nextField = FILTER_FIELDS.some((item) => item.key === value)
                            ? (value as CustomerFilterField)
                            : null;
                          updateFilterRow(row.id, { field: nextField, value: '' });
                        }}
                        placeholder="Choose field"
                        searchPlaceholder="Search fields…"
                        className="h-10 w-full"
                        options={[
                          { value: '__none__', label: 'Any field' },
                          ...FILTER_FIELDS.map((item) => ({ value: item.key, label: item.label })),
                        ]}
                      />
                    </div>
                    <div className="flex min-w-[160px] max-w-[min(100%,280px)] flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        {field === 'postcode' ? 'Area' : 'Is'}
                      </label>
                      {field === 'postcode' ? (
                        <SearchableMultiSelect
                          values={row.value ? splitPostcodeAreas(row.value) : []}
                          onValuesChange={(areas) => {
                            updateFilterRow(row.id, { value: areas.join(',') });
                          }}
                          placeholder="Any area"
                          searchPlaceholder="Search areas, e.g. SW1"
                          emptyText="No areas match."
                          className="h-10 w-full"
                          allowQueryValue
                          options={options.map((option) => ({ value: option, label: option }))}
                        />
                      ) : (
                        <SearchableSelect
                          value={row.value || '__none__'}
                          onValueChange={(value) => {
                            if (!field) return;
                            updateFilterRow(row.id, { value: value === '__none__' ? '' : value });
                          }}
                          placeholder={field ? 'Choose value' : 'Pick a field first'}
                          searchPlaceholder="Search values…"
                          className="h-10 w-full"
                          disabled={!field}
                          options={[
                            { value: '__none__', label: 'Any value' },
                            ...options.map((option) => ({ value: option, label: option })),
                          ]}
                        />
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-10 px-2 text-muted-foreground"
                      aria-label="Remove filter"
                      onClick={() => {
                        const next = filterRows.filter((item) => item.id !== row.id);
                        setFilterRows(next);
                        pushFilters(search, status, committedFilters(next));
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                    {index === 0 ? clearButton : null}
                  </div>
                );
              })}
              {filterRows.length < MAX_FILTERS ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => setFilterRows([...filterRows, newFilterRow()])}
                >
                  <Plus className="size-3.5" />
                  Add filter
                </Button>
              ) : null}
            </div>
        ) : null}
      </div>

      {fetchError ? (
        <p className="text-sm text-destructive">{fetchError}</p>
      ) : null}

      {visible.length === 0 ? (
        emptyBecauseFilter ? (
          <EmptyState icon={Search} title="No matches" body="Try a different search, status or filter." />
        ) : (
          <EmptyState
            icon={Users}
            title="No customers yet"
            body="Add your first customer to start planning the round, or bring them in from a spreadsheet."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild>
                  <Link href="/customers/new">Add customer</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/import">
                    <Upload className="mr-1.5 size-4" />
                    Import a spreadsheet
                  </Link>
                </Button>
              </div>
            }
          />
        )
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-(--look-card-shadow)">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_7rem_9rem_7rem_2rem] gap-4 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
            <span>Customer</span>
            <span>Service</span>
            <span>How often</span>
            <span>Next visit</span>
            <span>Money</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="divide-y divide-border">
            {visible.map((customer) => (
              <li
                key={customer.id}
                className={cn(
                  'relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/50',
                  'md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_7rem_9rem_7rem_2rem]',
                  !customer.is_active && 'opacity-70',
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={customer.name} tone={customer.owed_amount > 0 ? 'rose' : 'rounds'} />
                  <div className="min-w-0">
                    <Link
                      href={`/customers/${customer.id}`}
                      title={customer.name}
                      className="block truncate font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                    >
                      {customer.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {[customer.postcode?.toUpperCase(), phoneLabel(customer) !== '—' ? phoneLabel(customer) : null]
                        .filter(Boolean)
                        .join(' · ') || 'No address or phone yet'}
                    </p>
                  </div>
                  {!customer.is_active ? <Tag tone="slate">Inactive</Tag> : null}
                </div>

                <div className="relative z-10 flex items-center justify-end md:hidden" onClick={(e) => e.stopPropagation()}>
                  <RowMenu customer={customer} onAction={openConfirm} />
                </div>

                <p className="col-span-2 truncate text-sm text-muted-foreground md:col-span-1" title={customer.services.join(', ')}>
                  {servicesLabel(customer)}
                  {customer.agreement_count !== customer.active_agreement_count ? (
                    <span className="text-xs"> · {customer.active_agreement_count} of {customer.agreement_count} active</span>
                  ) : null}
                </p>
                <p className="hidden truncate text-sm text-muted-foreground md:block">{firstOf(customer.frequencies)}</p>
                <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1 md:contents">
                  <div className="md:block">
                    <NextVisit date={customer.next_visit_date} today={today} />
                  </div>
                  <div>
                    {customer.owed_amount > 0 ? (
                      <Tag tone="rose" className="tabular-nums">Owes {formatGbp(customer.owed_amount)}</Tag>
                    ) : (
                      <span className="text-sm text-muted-foreground">Paid up</span>
                    )}
                  </div>
                </div>
                <div className="relative z-10 hidden justify-end md:flex" onClick={(e) => e.stopPropagation()}>
                  <RowMenu customer={customer} onAction={openConfirm} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="lg:hidden">
        <FloatingAddButton href="/customers/new" label="Add customer" desktopLabel={false} />
      </div>

      <Dialog
        open={confirmTarget != null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === 'deactivate'
                ? 'Deactivate customer'
                : 'Reactivate customer'}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === 'deactivate' ? (
                <>
                  This deactivates{' '}
                  <span className="font-medium text-foreground">
                    {confirmTarget?.name}
                  </span>
                  . Visit history stays. You can reactivate them later.
                </>
              ) : (
                <>
                  Bring{' '}
                  <span className="font-medium text-foreground">
                    {confirmTarget?.name}
                  </span>{' '}
                  back onto the active list.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmAction === 'deactivate' ? 'destructive' : 'default'}
              onClick={() => void handleConfirm()}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {confirmAction === 'deactivate' ? 'Deactivate' : 'Reactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
