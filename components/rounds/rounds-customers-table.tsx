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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
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

function newFilterId(): string {
  return Math.random().toString(36).slice(2, 9);
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
  return terms === 'monthly_invoice' ? 'Monthly invoice' : 'On the day';
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
  const [fieldFilters, setFieldFilters] = useState<CustomerFieldFilter[]>(initialFilters);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<RoundsCustomerListRow | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<'deactivate' | 'reactivate'>(
    'deactivate',
  );
  const [isPending, setIsPending] = useState(false);

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
      pushFilters(value, status, fieldFilters);
    }, DEBOUNCE_MS);
  };

  const onStatusChange = (value: string) => {
    const next = (value === 'inactive' || value === 'all' ? value : 'active') as StatusFilter;
    setStatus(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushFilters(search, next, fieldFilters);
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

  const narrowed = customers.filter((customer) => matchesFieldFilters(customer, fieldFilters));
  const visible = narrowed;
  const emptyBecauseFilter =
    visible.length === 0 &&
    (search.trim().length > 0 || status !== 'active' || fieldFilters.length > 0);

  return (
    <>
      <Card className="glass-card border-border/80">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-[180px] flex-1 flex-col gap-1.5 sm:max-w-[280px]">
              <label className="text-xs font-medium text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
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
            {(search.trim() || status !== 'active' || fieldFilters.length > 0) && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-10"
                onClick={() => {
                  setSearch('');
                  setStatus('active');
                  setFieldFilters([]);
                  router.push('/customers');
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
          <div className="space-y-2 border-t border-border/60 pt-3">
            {(fieldFilters.length === 0 ? [null] : fieldFilters).map((filter, index) => {
              const field = filter?.field ?? null;
              const options = field ? valuesForField(customers, field) : [];
              return (
                <div key={`${filter?.field ?? 'new'}-${index}`} className="flex flex-wrap items-end gap-3">
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
                        const next = [...fieldFilters];
                        if (!nextField) {
                          next.splice(index, 1);
                        } else if (filter) {
                          next[index] = { field: nextField, value: '' };
                        } else {
                          next.push({ field: nextField, value: '' });
                        }
                        const committed = next.filter((item) => item.value);
                        setFieldFilters(committed.length > 0 || nextField ? next.filter((item) => item.field) : []);
                        pushFilters(search, status, committed);
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
                        values={filter?.value ? splitPostcodeAreas(filter.value) : []}
                        onValuesChange={(areas) => {
                          const chosen = areas.join(',');
                          const next = fieldFilters.map((item, itemIndex) =>
                            itemIndex === index ? { field, value: chosen } : item,
                          );
                          const committed = next.filter((item) => item.value);
                          setFieldFilters(committed);
                          pushFilters(search, status, committed);
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
                        value={filter?.value || '__none__'}
                        onValueChange={(value) => {
                          if (!field) return;
                          const chosen = value === '__none__' ? '' : value;
                          const next = fieldFilters.map((item, itemIndex) =>
                            itemIndex === index ? { field, value: chosen } : item,
                          );
                          const committed = next.filter((item) => item.value);
                          setFieldFilters(committed);
                          pushFilters(search, status, committed);
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
                  {filter ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-10 px-2 text-muted-foreground"
                      aria-label="Remove filter"
                      onClick={() => {
                        const next = fieldFilters.filter((_, itemIndex) => itemIndex !== index);
                        setFieldFilters(next);
                        pushFilters(search, status, next);
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </div>
              );
            })}
            {fieldFilters.length > 0 && fieldFilters.length < MAX_FILTERS && fieldFilters.every((item) => item.value) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setFieldFilters([...fieldFilters, { field: 'service', value: '' }])}
              >
                <Plus className="size-3.5" />
                Filter
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {fetchError ? (
        <p className="text-sm text-destructive">{fetchError}</p>
      ) : null}

      {visible.length === 0 ? (
        <Card className="glass-card border-border/80">
          <CardContent className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-muted bg-muted/30">
              <Users className="size-7 text-muted-foreground" />
            </div>
            {emptyBecauseFilter ? (
              <>
                <p className="mt-4 text-sm font-medium text-foreground">No matches</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a different search or status filter.
                </p>
              </>
            ) : (
              <>
                <p className="mt-4 text-sm font-medium text-foreground">No customers yet</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Add your first customer to start planning the round.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Button asChild>
                    <Link href="/customers/new">Add customer</Link>
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="glass-card overflow-hidden border-border/80">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Postcode</TableHead>
                  <TableHead>Agreements</TableHead>
                  <TableHead>Next visit</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((customer) => (
                  <TableRow
                    key={customer.id}
                    className={cn(
                      'cursor-pointer',
                      !customer.is_active && 'opacity-70',
                    )}
                    onClick={() => router.push(`/customers/${customer.id}`)}
                  >
                    <TableCell>
                      <Link
                        href={`/customers/${customer.id}`}
                        className="font-medium text-foreground hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {customer.name}
                      </Link>
                      {!customer.is_active ? (
                        <span className="ml-2 text-xs text-muted-foreground">Inactive</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {phoneLabel(customer)}
                    </TableCell>
                    <TableCell className="uppercase text-muted-foreground">
                      {customer.postcode ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {customer.active_agreement_count}
                      {customer.agreement_count !== customer.active_agreement_count
                        ? ` / ${customer.agreement_count}`
                        : null}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium',
                          whenOf(customer.next_visit_date, today) === 'overdue' &&
                            'border-rose-300/70 bg-rose-50 text-rose-800',
                          whenOf(customer.next_visit_date, today) === 'week' &&
                            'border-sky-300/70 bg-sky-50 text-sky-900',
                          whenOf(customer.next_visit_date, today) === 'later' &&
                            'border-emerald-300/70 bg-emerald-50 text-emerald-900',
                          whenOf(customer.next_visit_date, today) === 'none' &&
                            'border-border bg-muted/40 text-muted-foreground',
                        )}
                      >
                        {formatVisitDate(customer.next_visit_date)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Actions for ${customer.name}`}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/customers/${customer.id}`}
                              className="gap-2"
                            >
                              <Eye className="size-3.5" />
                              View
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/customers/${customer.id}/edit`}
                              className="gap-2"
                            >
                              <Pencil className="size-3.5" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                          {customer.is_active ? (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => openConfirm(customer, 'deactivate')}
                            >
                              <UserMinus className="size-3.5" />
                              Deactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => openConfirm(customer, 'reactivate')}
                            >
                              <UserCheck className="size-3.5" />
                              Reactivate
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <FloatingAddButton
        href="/customers/new"
        label="Add customer"
        desktopLabel={false}
      />

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
