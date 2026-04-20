'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Briefcase,
  Loader2,
  AlertCircle,
  RefreshCw,
  List,
  Layers,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Check,
  X,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  type CustomerJobCount,
  type JobRow,
  type JobsFilters,
  type JobStatus,
  type JobsStatusSummary,
} from '@/lib/data/jobs';
import { JOB_STATUS_DISPLAY } from '@/lib/job-status-display';
import { JobsGroupedView } from '@/components/jobs/jobs-grouped-view';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { bulkDeleteJobs } from '@/lib/actions/jobs';
import { format, parseISO, isValid } from 'date-fns';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;

const STATUS_TOOLTIPS: Record<JobStatus, string> = {
  pending: 'In the queue; not yet assigned to a worker.',
  pending_send: 'Worker chosen — send from jobs list to notify their app.',
  assigned: 'Worker assigned — waiting to start on site.',
  in_progress: 'Work is underway.',
  completed: 'Finished.',
  cancelled: 'Cancelled; will not be completed.',
};

const FILTER_TABS: { value: 'all' | JobStatus; dbStatuses?: JobStatus[] }[] = [
  { value: 'all' },
  { value: 'pending' },
  { value: 'pending_send' },
  { value: 'in_progress' },
  { value: 'assigned' },
  { value: 'completed' },
];

function StatusBadge({ status }: { status: JobStatus | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const meta = JOB_STATUS_DISPLAY[status];
  const label = meta?.label ?? status;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex cursor-help items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm transition-shadow',
            meta?.badgeClass
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-left">
        {STATUS_TOOLTIPS[status]}
      </TooltipContent>
    </Tooltip>
  );
}

function formatScheduledDateTime(dateStr: string | null, timeStr: string | null) {
  if (!dateStr && !timeStr) return '—';
  try {
    const timeShort = timeStr && timeStr.length >= 5 ? timeStr.slice(0, 5) : null;
    if (dateStr) {
      const iso = dateStr.length <= 10 ? `${dateStr}T12:00:00` : dateStr;
      const d = parseISO(iso);
      if (!isValid(d)) return dateStr + (timeShort ? ` · ${timeShort}` : '');
      const datePart = format(d, 'd MMM yyyy');
      return timeShort ? `${datePart} · ${timeShort}` : datePart;
    }
    return timeShort ?? '—';
  } catch {
    return [dateStr, timeStr].filter(Boolean).join(' ') || '—';
  }
}

function truncateAddress(addr: string | null, max = 48) {
  if (!addr) return '—';
  if (addr.length <= max) return addr;
  return addr.slice(0, max).trim() + '…';
}

interface JobsTableProps {
  initialJobs: JobRow[];
  totalCount: number;
  initialFilters: JobsFilters & { page?: number; view?: 'list' | 'grouped' };
  fetchError: Error | null;
  statusSummary: JobsStatusSummary;
  customerFilterOptions: CustomerJobCount[];
  customerCompletionSummary: { total: number; completed: number } | null;
}

export function JobsTable({
  initialJobs,
  totalCount,
  initialFilters,
  fetchError,
  statusSummary,
  customerFilterOptions,
  customerCompletionSummary,
}: JobsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(initialFilters.search ?? '');
  const [isNavigating, setIsNavigating] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const stripScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const deletableJobs = useMemo(
    () => initialJobs.filter((j) => j.status !== 'in_progress'),
    [initialJobs]
  );

  useEffect(() => {
    const valid = new Set(initialJobs.map((j) => j.id));
    setSelectedIds((prev) => new Set([...prev].filter((id) => valid.has(id))));
  }, [initialJobs]);

  const toggleSelectAll = () => {
    const ids = deletableJobs.map((j) => j.id);
    if (ids.length === 0) return;
    const allSelected = ids.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...ids]));
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    const count = selectedIds.size;
    const ids = Array.from(selectedIds);
    setIsBulkDeleting(true);
    const result = await bulkDeleteJobs(ids);
    setIsBulkDeleting(false);
    setBulkDeleteOpen(false);
    if (result.success) {
      setSelectedIds(new Set());
      toast.success(count === 1 ? 'Job deleted' : `${count} jobs deleted`);
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to delete jobs');
    }
  };

  const allDeletableSelected =
    deletableJobs.length > 0 && deletableJobs.every((j) => selectedIds.has(j.id));

  const statusFilter = initialFilters.status;
  const statusArray = Array.isArray(statusFilter)
    ? statusFilter
    : statusFilter
      ? [statusFilter]
      : [];

  const resolvedTab: 'all' | JobStatus = (() => {
    if (statusArray.length !== 1) return 'all';
    const s = statusArray[0];
    if (
      s === 'pending' ||
      s === 'pending_send' ||
      s === 'in_progress' ||
      s === 'assigned' ||
      s === 'completed'
    )
      return s;
    return 'all';
  })();

  useEffect(() => {
    setSearchInput(initialFilters.search ?? '');
  }, [initialFilters.search]);

  useEffect(() => {
    if (fetchError) {
      toast.error('Failed to load jobs', {
        description: fetchError.message,
      });
    }
  }, [fetchError]);

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      const hasFilterChange = Object.keys(updates).some((k) => k !== 'page');
      if (hasFilterChange) next.delete('page');
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      router.push(`/jobs?${next.toString()}`, { scroll: false });
      setIsNavigating(true);
    },
    [router, searchParams]
  );

  const setStatusFilter = (tab: 'all' | JobStatus) => {
    if (tab === 'all') {
      updateParams({ status: undefined });
      return;
    }
    updateParams({ status: tab });
  };

  const sortedCustomerFilterOptions = useMemo(
    () => [...customerFilterOptions].sort((a, b) => a.name.localeCompare(b.name)),
    [customerFilterOptions]
  );

  const customerSelectValue = initialFilters.customer_id ?? '__all__';

  const sortCol = initialFilters.sort ?? 'created_at';
  const sortDir = initialFilters.sort_dir ?? 'desc';
  const toggleSort = (col: JobsFilters['sort']) => {
    if (!col) return;
    const nextDir = sortCol === col && sortDir === 'desc' ? 'asc' : 'desc';
    updateParams({ sort: col, sort_dir: nextDir });
  };
  const SortIcon = ({ column }: { column: JobsFilters['sort'] }) => {
    if (sortCol !== column) return <ArrowUpDown className="ml-0.5 size-3.5 opacity-50" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="ml-0.5 size-3.5" />
    ) : (
      <ArrowDown className="ml-0.5 size-3.5" />
    );
  };

  useEffect(() => {
    const t = setTimeout(() => {
      const current = searchParams.get('search') ?? '';
      if (searchInput.trim() !== current) {
        updateParams({ search: searchInput.trim() || undefined });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput, updateParams, searchParams]);

  useEffect(() => {
    setIsNavigating(false);
  }, [initialJobs, initialFilters]);

  const hasFilters = !!(
    initialFilters.search ||
    initialFilters.status ||
    initialFilters.date_from ||
    initialFilters.date_to ||
    initialFilters.customer_id ||
    initialFilters.priority
  );
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  const currentPage = Math.min(Math.max(1, initialFilters.page ?? 1), totalPages);
  const isEmpty = initialJobs.length === 0 && !fetchError;
  const showPagination = totalCount > PAGE_SIZE;

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setTableScrollWidth(el.scrollWidth);
    });
    ro.observe(el);
    setTableScrollWidth(el.scrollWidth);
    return () => ro.disconnect();
  }, [initialJobs.length]);

  const onStripScroll = useCallback(() => {
    const strip = stripScrollRef.current;
    const table = tableScrollRef.current;
    if (strip && table && strip.scrollLeft !== table.scrollLeft) {
      table.scrollLeft = strip.scrollLeft;
    }
  }, []);
  const onTableScroll = useCallback(() => {
    const strip = stripScrollRef.current;
    const table = tableScrollRef.current;
    if (strip && table && table.scrollLeft !== strip.scrollLeft) {
      strip.scrollLeft = table.scrollLeft;
    }
  }, []);

  const summaryItems = [
    {
      key: 'pending',
      count: statusSummary.notStarted,
      title: 'Not Started',
      className: JOB_STATUS_DISPLAY.pending.summaryBarClass,
    },
    {
      key: 'pending_send',
      count: statusSummary.readyToSend,
      title: 'Ready to send',
      className: JOB_STATUS_DISPLAY.pending_send.summaryBarClass,
    },
    {
      key: 'in_progress',
      count: statusSummary.inProgress,
      title: 'In Progress',
      className: JOB_STATUS_DISPLAY.in_progress.summaryBarClass,
    },
    {
      key: 'assigned',
      count: statusSummary.paused,
      title: 'Paused',
      className: JOB_STATUS_DISPLAY.assigned.summaryBarClass,
    },
    {
      key: 'completed',
      count: statusSummary.completed,
      title: 'Completed',
      className: JOB_STATUS_DISPLAY.completed.summaryBarClass,
    },
  ] as const;

  const customerFilteredCompletionBanner =
    initialFilters.customer_id && customerCompletionSummary ? (
      <div className="shrink-0 border-b border-border/60 bg-muted/30 px-4 py-2.5 text-sm">
        <span className="tabular-nums font-semibold text-foreground">
          {customerCompletionSummary.completed}
        </span>
        <span className="text-muted-foreground"> of </span>
        <span className="tabular-nums font-semibold text-foreground">
          {customerCompletionSummary.total}
        </span>
        <span className="text-muted-foreground"> jobs completed</span>
      </div>
    ) : null;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Status summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {summaryItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setStatusFilter(item.key)}
              className={cn(
                'rounded-xl px-4 py-3 text-left transition-all hover:opacity-95 hover:shadow-md',
                item.className,
                resolvedTab === item.key && 'ring-2 ring-primary/50 ring-offset-2 ring-offset-background'
              )}
            >
              <p className="text-xs font-medium opacity-90">{item.title}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{item.count}</p>
            </button>
          ))}
        </div>

        <Card
          className={cn(
            'glass-card overflow-hidden border-border/80 transition-all duration-300',
            'dark:border-white/[0.06]',
            'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
          )}
        >
          <CardContent className="p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-[180px] flex-1 sm:max-w-[280px]">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search ref, address, description…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-9"
                    aria-label="Search jobs"
                  />
                </div>
                <div className="flex min-w-[200px] max-w-[min(100%,320px)] flex-col gap-1.5">
                  <label htmlFor="jobs-customer-filter" className="sr-only">
                    Filter by customer
                  </label>
                  <Select
                    value={customerSelectValue}
                    onValueChange={(v) => {
                      if (v === '__all__') updateParams({ customer_id: undefined });
                      else updateParams({ customer_id: v });
                    }}
                  >
                    <SelectTrigger id="jobs-customer-filter" className="h-10 w-full" aria-label="Filter by customer">
                      <SelectValue placeholder="All customers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All customers</SelectItem>
                      {sortedCustomerFilterOptions.map((c) => (
                        <SelectItem
                          key={c.customer_id ?? 'none'}
                          value={c.customer_id ?? 'none'}
                        >
                          {`${c.name} (${c.count})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1 rounded-md border border-border/80 p-0.5">
                  <Button
                    variant={initialFilters.view !== 'grouped' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => updateParams({ view: 'list' })}
                  >
                    <List className="size-3.5" />
                    List
                  </Button>
                  <Button
                    variant={initialFilters.view === 'grouped' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => updateParams({ view: 'grouped' })}
                  >
                    <Layers className="size-3.5" />
                    Grouped
                  </Button>
                </div>
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchInput('');
                      router.push('/jobs', { scroll: false });
                    }}
                  >
                    Clear filters
                  </Button>
                )}
                <Button variant="gradient" size="default" className="ml-auto shrink-0" asChild>
                  <Link href="/jobs/new">
                    <Plus className="size-4" />
                    New Job
                  </Link>
                </Button>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                <span className="mr-1 w-full text-xs font-medium text-muted-foreground sm:w-auto sm:self-center">
                  Status
                </span>
                {FILTER_TABS.map((tab) => {
                  const isAll = tab.value === 'all';
                  const active = isAll ? resolvedTab === 'all' : resolvedTab === tab.value;
                  const label =
                    tab.value === 'all'
                      ? 'All'
                      : JOB_STATUS_DISPLAY[tab.value as JobStatus].label;
                  return (
                    <Button
                      key={tab.value}
                      variant={active ? 'secondary' : 'outline'}
                      size="sm"
                      className={cn('h-8 rounded-full', active && 'ring-1 ring-primary/30')}
                      onClick={() => setStatusFilter(tab.value)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                Delete {selectedIds.size} job{selectedIds.size === 1 ? '' : 's'}
              </DialogTitle>
              <DialogDescription>
                Are you sure? This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
              >
                {isBulkDeleting ? <Loader2 className="size-4 animate-spin" /> : null}
                Delete selected
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card
          className={cn(
            'glass-card overflow-hidden border-border/80 transition-all duration-300',
            'dark:border-white/[0.06]',
            'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
          )}
        >
          {isNavigating ? (
            <div className="flex min-h-[320px] items-center justify-center p-8">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="size-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading jobs…</p>
              </div>
            </div>
          ) : fetchError ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 p-8">
              <div className="rounded-full border border-destructive/30 bg-destructive/10 p-4">
                <AlertCircle className="size-8 text-destructive" />
              </div>
              <div className="text-center">
                <h3 className="font-semibold text-foreground">Failed to load jobs</h3>
                <p className="mt-1 text-sm text-muted-foreground">{fetchError.message}</p>
              </div>
              <Button variant="outline" onClick={() => router.refresh()} className="gap-2">
                <RefreshCw className="size-4" />
                Retry
              </Button>
            </div>
          ) : isEmpty ? (
            <div className="flex min-h-[380px] flex-col items-center justify-center p-8 text-center">
              <div
                className={cn(
                  'rounded-2xl border border-border/80 p-8',
                  'bg-muted/30 dark:bg-muted/20',
                  'backdrop-blur-sm'
                )}
              >
                <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
                  <Briefcase className="size-8 text-primary" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-foreground">
                  {hasFilters ? 'No jobs match your filters' : 'No jobs yet'}
                </h3>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  {hasFilters
                    ? 'Try clearing filters or changing your criteria.'
                    : 'Get started by creating your first job or importing from CSV.'}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  {hasFilters ? (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => router.push('/jobs', { scroll: false })}
                    >
                      Clear filters
                    </Button>
                  ) : null}
                  <Button variant="gradient" size="lg" asChild>
                    <Link href="/jobs/new">
                      <Plus className="size-4" />
                      Create Job
                    </Link>
                  </Button>
                  <Button variant="outline" size="lg" asChild>
                    <Link href="/import">Import Jobs</Link>
                  </Button>
                </div>
              </div>
            </div>
          ) : initialFilters.view === 'grouped' ? (
            <>
              {customerFilteredCompletionBanner}
              <JobsGroupedView jobs={initialJobs} />
            </>
          ) : (
            <>
              <div className="flex max-h-[calc(100vh-14rem)] min-h-[320px] flex-col">
                {customerFilteredCompletionBanner}
                {selectedIds.size > 0 && (
                  <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/80 bg-primary/5 px-4 py-2">
                    <span className="text-sm font-medium">{selectedIds.size} selected</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setBulkDeleteOpen(true)}
                    >
                      <Trash2 className="size-4" />
                      Delete selected
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      <X className="size-4" />
                      Clear selection
                    </Button>
                  </div>
                )}
                {tableScrollWidth > 0 && (
                  <div
                    ref={stripScrollRef}
                    className="flex shrink-0 overflow-x-auto overflow-y-hidden border-b border-border/60 bg-muted/40 py-1.5"
                    onScroll={onStripScroll}
                    style={{ minHeight: 16 }}
                  >
                    <div style={{ width: tableScrollWidth, height: 1 }} aria-hidden />
                  </div>
                )}
                <div
                  ref={tableScrollRef}
                  className="min-h-0 flex-1 overflow-auto"
                  onScroll={onTableScroll}
                >
                  <table className="w-full caption-bottom text-sm">
                    <TableHeader>
                      <TableRow className="border-border/80 hover:bg-transparent">
                        <TableHead className="w-10 text-muted-foreground">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectAll();
                            }}
                            disabled={deletableJobs.length === 0}
                            className="rounded border border-input p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label="Select all jobs that can be deleted"
                          >
                            {allDeletableSelected ? (
                              <Check className="size-4 text-primary" />
                            ) : (
                              <span className="block size-4" />
                            )}
                          </button>
                        </TableHead>
                        <TableHead className="text-muted-foreground">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSort('reference_number');
                            }}
                            className="inline-flex items-center hover:text-foreground"
                          >
                            Reference #
                            <SortIcon column="reference_number" />
                          </button>
                        </TableHead>
                        <TableHead className="text-muted-foreground">Customer</TableHead>
                        <TableHead className="text-muted-foreground">Address</TableHead>
                        <TableHead className="text-muted-foreground">Worker</TableHead>
                        <TableHead className="text-muted-foreground">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSort('scheduled_date');
                            }}
                            className="inline-flex items-center hover:text-foreground"
                          >
                            Scheduled
                            <SortIcon column="scheduled_date" />
                          </button>
                        </TableHead>
                        <TableHead className="text-muted-foreground">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSort('status');
                            }}
                            className="inline-flex items-center hover:text-foreground"
                          >
                            Status
                            <SortIcon column="status" />
                          </button>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {initialJobs.map((job, i) => (
                        <TableRow
                          key={job.id}
                          className={cn(
                            'cursor-pointer border-border/60 transition-all duration-200',
                            'hover:bg-primary/5 hover:shadow-[0_0_20px_-8px_var(--glow-primary)]',
                            'dark:hover:bg-primary/10',
                            i % 2 === 1 && 'bg-muted/20 dark:bg-muted/10'
                          )}
                          onClick={() => router.push(`/jobs/${job.id}`)}
                        >
                          <TableCell
                            className="w-10 align-middle"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {job.status === 'in_progress' ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex cursor-not-allowed rounded border border-input/50 p-0.5 opacity-50">
                                    <span className="block size-4" aria-hidden />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  In progress jobs cannot be deleted.
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleSelect(job.id)}
                                className="rounded border border-input p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={
                                  selectedIds.has(job.id)
                                    ? 'Deselect job'
                                    : 'Select job'
                                }
                              >
                                {selectedIds.has(job.id) ? (
                                  <Check className="size-4 text-primary" />
                                ) : (
                                  <span className="block size-4" />
                                )}
                              </button>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            <Link
                              href={`/jobs/${job.id}`}
                              className="text-primary hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {job.reference_number || job.id.slice(0, 8)}
                            </Link>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-muted-foreground">
                            {job.customer_name ?? (
                              <span className="text-muted-foreground/70">—</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[240px] truncate text-muted-foreground">
                            {truncateAddress(job.address, 44)}
                          </TableCell>
                          <TableCell>
                            {job.worker_name ?? (
                              <span className="text-muted-foreground">Unassigned</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                            {formatScheduledDateTime(job.scheduled_date, job.scheduled_time)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={job.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </table>
                </div>
              </div>

              {showPagination && (
                <div className="flex items-center justify-between border-t border-border/80 px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                    {Math.min(currentPage * PAGE_SIZE, totalCount)} of {totalCount}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage <= 1}
                      onClick={() =>
                        updateParams({
                          page: currentPage > 2 ? String(currentPage - 1) : undefined,
                        })
                      }
                    >
                      <ChevronLeft className="size-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage >= totalPages}
                      onClick={() => updateParams({ page: String(currentPage + 1) })}
                    >
                      Next
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </TooltipProvider>
  );
}
