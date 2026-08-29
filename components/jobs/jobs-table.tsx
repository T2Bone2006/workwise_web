'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
  CircleDashed,
  RadioTower,
  PauseCircle,
  CheckCircle2,
  CircleAlert,
  UserCheck,
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
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  type ImportBatchRow,
  type JobRow,
  type JobsFilters,
  type JobStatus,
  type JobPriority,
  type JobsStatusSummary,
} from '@/lib/data/jobs';
import { formatTimeRange } from '@/lib/jobs/format-job-time';
import type { FieldFilterValueOption } from '@/lib/jobs/field-filter';
import {
  MAX_FIELD_FILTERS,
  writeFieldFiltersToSearchParams,
} from '@/lib/jobs/field-filter';
import type { SearchableSelectOption } from '@/components/ui/searchable-select';
import { fetchFieldFilterValuesAction } from '@/lib/actions/jobs-field-filter';
import {
  jobDetailHref,
  rememberJobsListState,
} from '@/lib/jobs/jobs-list-query';
import { JOB_STATUS_DISPLAY } from '@/lib/job-status-display';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { bulkDeleteJobs, sendPendingJobsToWorkers } from '@/lib/actions/jobs';
import { format, parseISO, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { BatchesView } from '@/components/jobs/batches-view';
import { BatchesCustomerView } from '@/components/jobs/batches-customer-view';
import { ExportJobsButton } from '@/components/jobs/export-jobs-button';
import { JobsDateRangeFilter } from '@/components/jobs/jobs-date-range-filter';
import { JobsColumnsPicker } from '@/components/jobs/jobs-columns-picker';
import { updateJobsListColumns } from '@/lib/actions/jobs-columns';
import { type JobsListColumnKey } from '@/lib/data/settings-types';
import { FloatingAddButton } from '@/components/ui/floating-add-button';

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;

const STATUS_TOOLTIPS: Record<JobStatus, string> = {
  pending: 'In the queue; not yet assigned to a worker.',
  pending_send: 'Worker chosen — send from jobs list to notify their app.',
  assigned: 'Worker assigned — waiting to start on site.',
  in_progress: 'Work is underway.',
  paused: 'Work paused temporarily.',
  completed: 'Finished.',
  incomplete:
    'Worker submitted a report but the work was not done — needs re-planning or closing.',
  declined: 'Worker declined this job.',
  cancelled: 'Cancelled; will not be completed.',
};

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

const PRIORITY_BADGE_CLASS: Record<JobPriority, string> = {
  low: 'border-slate-400/60 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  normal: 'border-blue-400/60 bg-blue-500/10 text-blue-800 dark:text-blue-300',
  high: 'border-amber-400/60 bg-amber-500/10 text-amber-900 dark:text-amber-300',
  emergency: 'border-red-400/60 bg-red-500/10 text-red-900 dark:text-red-300',
};

function PriorityBadge({ priority }: { priority: JobPriority | null }) {
  if (!priority) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm',
        PRIORITY_BADGE_CLASS[priority]
      )}
    >
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}

const SEND_ARM_TIMEOUT_MS = 4000;

/**
 * The "Ready to send" badge, made clickable — but a single tap can't fire a
 * real notification to a worker by accident. First click arms it (badge
 * flips to a distinct "Click to send" state); the SAME click target must be
 * tapped again to actually send. Arming clears itself after a few seconds,
 * or the moment any other row is armed, so a stray armed badge never sits
 * there waiting to be mis-tapped later.
 */
function SendJobBadge({
  jobId,
  armed,
  sending,
  onArm,
  onConfirm,
}: {
  jobId: string;
  armed: boolean;
  sending: boolean;
  onArm: (jobId: string) => void;
  onConfirm: (jobId: string) => void;
}) {
  const meta = JOB_STATUS_DISPLAY.pending_send;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={sending}
          onClick={(e) => {
            e.stopPropagation();
            if (armed) onConfirm(jobId);
            else onArm(jobId);
          }}
          className={cn(
            'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm transition-all',
            armed
              ? 'animate-pulse border-cyan-500 bg-cyan-600 text-white shadow-[0_0_0_2px_rgba(8,145,178,0.25)]'
              : cn('cursor-pointer hover:brightness-95', meta?.badgeClass),
            sending && 'cursor-wait opacity-70'
          )}
        >
          {sending ? 'Sending…' : armed ? 'Click to send' : meta?.label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-left">
        {armed ? 'Click again to send this job to the worker now.' : 'Click to send this job now.'}
      </TooltipContent>
    </Tooltip>
  );
}

function formatScheduledDateTime(
  dateStr: string | null,
  timeStr: string | null,
  endTimeStr?: string | null
) {
  if (!dateStr && !timeStr && !endTimeStr) return '—';
  try {
    const timeShort = formatTimeRange(timeStr, endTimeStr);
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

function formatDateOnly(value: string | null) {
  if (!value) return '—';
  try {
    const iso = value.length <= 10 ? `${value}T12:00:00` : value;
    const d = parseISO(iso);
    if (!isValid(d)) return value;
    return format(d, 'd MMM yyyy');
  } catch {
    return value;
  }
}

interface FilterRowState {
  id: string;
  field: string | null;
  value: string | null;
}

function newFilterRow(partial?: Partial<FilterRowState>): FilterRowState {
  return {
    id: `fr-${Math.random().toString(36).slice(2, 9)}`,
    field: partial?.field ?? null,
    value: partial?.value ?? null,
  };
}

function committedFiltersKey(
  rows: Array<{ field: string | null; value: string | null }>
): string {
  return JSON.stringify(committedFiltersFromRows(rows));
}

function committedFiltersFromRows(
  rows: Array<{ field: string | null; value: string | null }>
): Array<{ field: string; value: string }> {
  return rows
    .filter((r): r is { field: string; value: string } => !!(r.field && r.value))
    .map((r) => ({ field: r.field, value: r.value }));
}

interface JobsTableProps {
  initialJobs: JobRow[];
  totalCount: number;
  initialFilters: JobsFilters & { page?: number; view?: 'list' | 'batches' };
  fetchError: Error | null;
  statusSummary: JobsStatusSummary;
  batches: ImportBatchRow[];
  activeBatchId: string | null;
  fieldFilterOptions: SearchableSelectOption[];
  fieldFilterValuesByField: Record<string, FieldFilterValueOption[]>;
  initialVisibleColumns: JobsListColumnKey[];
}

export function JobsTable({
  initialJobs,
  totalCount,
  initialFilters,
  fetchError,
  statusSummary,
  batches,
  activeBatchId,
  fieldFilterOptions,
  fieldFilterValuesByField,
  initialVisibleColumns,
}: JobsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(initialFilters.search ?? '');
  const lastPushedSearch = useRef(initialFilters.search ?? '');
  const lastPushedFieldFilters = useRef(
    JSON.stringify(initialFilters.field_filters ?? [])
  );
  const [isNavigating, setIsNavigating] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const stripScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [armedSendId, setArmedSendId] = useState<string | null>(null);
  const [sendingSingleId, setSendingSingleId] = useState<string | null>(null);
  const armedSendTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sendSelectedOpen, setSendSelectedOpen] = useState(false);
  const [isSendingSelected, setIsSendingSelected] = useState(false);
  const [filterRows, setFilterRows] = useState<FilterRowState[]>(() => {
    const fromUrl = initialFilters.field_filters ?? [];
    if (fromUrl.length === 0) return [newFilterRow()];
    return fromUrl.map((f) => newFilterRow({ field: f.field, value: f.value }));
  });
  const [valuesByField, setValuesByField] = useState<
    Record<string, FieldFilterValueOption[]>
  >(() => fieldFilterValuesByField);

  // Column visibility is purely a rendering choice — it never changes what's
  // fetched, so toggling is instant, local state. The account-wide default
  // is persisted in the background (see updateJobsListColumns) rather than
  // round-tripped through the URL like actual filters.
  const [visibleColumns, setVisibleColumns] = useState<Set<JobsListColumnKey>>(
    () => new Set(initialVisibleColumns)
  );
  const columnsDidMount = useRef(false);
  useEffect(() => {
    if (!columnsDidMount.current) {
      columnsDidMount.current = true;
      return;
    }
    const t = setTimeout(() => {
      void updateJobsListColumns([...visibleColumns]).then((result) => {
        if (!result.success) toast.error('Failed to save column preferences');
      });
    }, 500);
    return () => clearTimeout(t);
  }, [visibleColumns]);
  const toggleColumn = useCallback((key: JobsListColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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

  const armSend = (jobId: string) => {
    if (armedSendTimeoutRef.current) clearTimeout(armedSendTimeoutRef.current);
    setArmedSendId(jobId);
    armedSendTimeoutRef.current = setTimeout(() => {
      setArmedSendId((current) => (current === jobId ? null : current));
    }, SEND_ARM_TIMEOUT_MS);
  };

  useEffect(() => {
    return () => {
      if (armedSendTimeoutRef.current) clearTimeout(armedSendTimeoutRef.current);
    };
  }, []);

  const confirmSend = async (jobId: string) => {
    if (armedSendTimeoutRef.current) clearTimeout(armedSendTimeoutRef.current);
    setArmedSendId(null);
    setSendingSingleId(jobId);
    try {
      const result = await sendPendingJobsToWorkers([jobId]);
      if (result.success) {
        toast.success('Job sent to worker');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to send job');
    } finally {
      setSendingSingleId(null);
    }
  };

  const sendableSelectedIds = useMemo(
    () =>
      Array.from(selectedIds).filter(
        (id) => initialJobs.find((j) => j.id === id)?.status === 'pending_send'
      ),
    [selectedIds, initialJobs]
  );

  const handleSendSelected = async () => {
    if (sendableSelectedIds.length === 0) return;
    setIsSendingSelected(true);
    try {
      const result = await sendPendingJobsToWorkers(sendableSelectedIds);
      setSendSelectedOpen(false);
      if (result.success) {
        setSelectedIds(new Set());
        toast.success(
          result.sent === 1 ? 'Job sent to worker' : `${result.sent} jobs sent to workers`
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Failed to send jobs');
    } finally {
      setIsSendingSelected(false);
    }
  };

  useEffect(() => {
    setValuesByField((prev) => ({ ...prev, ...fieldFilterValuesByField }));
  }, [fieldFilterValuesByField]);

  // Adopt URL filters only when they changed outside our own commits (back / clear).
  // Rebuilding rows on every result refresh remounts selectors and wipes draft rows.
  const fieldFiltersKey = JSON.stringify(initialFilters.field_filters ?? []);
  useEffect(() => {
    if (fieldFiltersKey === lastPushedFieldFilters.current) return;
    lastPushedFieldFilters.current = fieldFiltersKey;
    const fromUrl = initialFilters.field_filters ?? [];
    setFilterRows(
      fromUrl.length === 0
        ? [newFilterRow()]
        : fromUrl.map((f) => newFilterRow({ field: f.field, value: f.value }))
    );
  }, [fieldFiltersKey, initialFilters.field_filters]);

  // Only persist while we are actually on the list. During detail navigation,
  // useSearchParams can briefly update and would otherwise wipe the snapshot.
  // Prefer committed rows from UI state so stacked filters aren't lost.
  useEffect(() => {
    if (pathname !== '/jobs') return;
    rememberJobsListState(
      searchParams.toString(),
      committedFiltersFromRows(filterRows)
    );
  }, [pathname, searchParams, filterRows]);

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
      rememberJobsListState(next.toString(), committedFiltersFromRows(filterRows));
      router.push(`/jobs?${next.toString()}`, { scroll: false });
      setIsNavigating(true);
    },
    [router, searchParams, filterRows]
  );

  // Debounced search → URL. Do not reset the input when results return mid-typing.
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = searchInput.trim();
      const current = searchParams.get('search') ?? '';
      if (trimmed !== current) {
        lastPushedSearch.current = trimmed;
        updateParams({ search: trimmed || undefined });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput, searchParams, updateParams]);

  // Adopt URL search only when it changed outside our debounce (back / clear).
  useEffect(() => {
    const urlSearch = searchParams.get('search') ?? '';
    if (urlSearch === lastPushedSearch.current) return;
    lastPushedSearch.current = urlSearch;
    setSearchInput(urlSearch);
  }, [searchParams]);

  const commitFilterRows = useCallback(
    (rows: FilterRowState[]) => {
      const next = new URLSearchParams(searchParams.toString());
      next.delete('page');
      const committed = committedFiltersFromRows(rows);
      writeFieldFiltersToSearchParams(next, committed);
      lastPushedFieldFilters.current = JSON.stringify(committed);
      const qs = next.toString();
      rememberJobsListState(qs, committed);
      if (qs === searchParams.toString()) return;
      router.push(`/jobs?${qs}`, { scroll: false });
      setIsNavigating(true);
    },
    [router, searchParams]
  );

  const ensureValuesForField = useCallback(
    async (field: string) => {
      if (!field || valuesByField[field]) return;
      // Source-field options only ever appear in fieldFilterOptions when
      // we're scoped to a customer (see JobsPage) — safe to always pass
      // customer_id through, it's a no-op for system fields.
      const values = await fetchFieldFilterValuesAction(field, initialFilters.customer_id);
      setValuesByField((prev) => ({ ...prev, [field]: values }));
    },
    [valuesByField, initialFilters.customer_id]
  );

  const updateFilterRow = (id: string, patch: Partial<FilterRowState>) => {
    const prev = filterRows.find((r) => r.id === id);
    const next = filterRows.map((row) => (row.id === id ? { ...row, ...patch } : row));
    setFilterRows(next);

    const wasCommitted = !!(prev?.field && prev.value);
    const changed = next.find((r) => r.id === id);
    const isCommitted = !!(changed?.field && changed.value);

    // Only update the URL when the set of complete filters changes.
    // Picking a field (Any value) stays local so drafts / extra rows aren't wiped.
    if (!wasCommitted && !isCommitted) return;
    const key = committedFiltersKey(next);
    if (key === lastPushedFieldFilters.current) return;
    commitFilterRows(next);
  };

  const removeFilterRow = (id: string) => {
    const filtered = filterRows.filter((r) => r.id !== id);
    const rows = filtered.length === 0 ? [newFilterRow()] : filtered;
    setFilterRows(rows);

    const key = committedFiltersKey(rows);
    if (key === lastPushedFieldFilters.current) return;
    commitFilterRows(rows);
  };

  const addFilterRow = () => {
    setFilterRows((prev) => {
      if (prev.length >= MAX_FIELD_FILTERS) return prev;
      return [...prev, newFilterRow()];
    });
  };

  const activeCustomerId = initialFilters.customer_id ?? null;

  const sortedBatchFilterOptions = useMemo(
    () =>
      [...batches]
        .filter((b) => b.id !== 'ungrouped')
        // Once drilled into a customer, only offer that customer's own
        // batches here too — picking a different customer's batch while
        // still "inside" this one would be an inconsistent combination.
        .filter((b) => !activeCustomerId || b.customer_id === activeCustomerId)
        .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? '')),
    [batches, activeCustomerId]
  );

  const activeBatch = activeBatchId
    ? batches.find((batch) => batch.id === activeBatchId) ?? null
    : null;

  const customerBatches = useMemo(
    () =>
      activeCustomerId
        ? batches.filter((b) => b.id !== 'ungrouped' && b.customer_id === activeCustomerId)
        : [],
    [batches, activeCustomerId]
  );
  const activeCustomerName = activeCustomerId
    ? customerBatches[0]?.customer_name ?? 'Customer'
    : null;
  // Level 0/1 of the Batches tab shows grids, not job rows — no columns to pick yet.
  const isBrowsingBatchesGrid = initialFilters.view === 'batches' && !activeBatchId;

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
    setIsNavigating(false);
  }, [initialJobs, initialFilters]);

  const hasFilters = !!(
    initialFilters.search ||
    initialFilters.status ||
    initialFilters.date_from ||
    initialFilters.date_to ||
    initialFilters.customer_id ||
    initialFilters.priority ||
    (initialFilters.field_filters && initialFilters.field_filters.length > 0) ||
    activeBatchId
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
      icon: CircleDashed,
      glow: 'rgb(100 116 139)',
    },
    {
      key: 'pending_send',
      count: statusSummary.readyToSend,
      title: 'Ready to send',
      icon: RadioTower,
      glow: 'rgb(6 182 212)',
    },
    {
      key: 'assigned',
      count: statusSummary.assigned,
      title: 'Assigned',
      icon: UserCheck,
      glow: 'rgb(245 158 11)',
    },
    {
      key: 'in_progress',
      count: statusSummary.inProgress,
      title: 'In Progress',
      icon: Briefcase,
      glow: 'rgb(59 130 246)',
    },
    {
      key: 'paused',
      count: statusSummary.paused,
      title: 'Paused',
      icon: PauseCircle,
      glow: 'rgb(180 83 9)',
    },
    {
      key: 'completed',
      count: statusSummary.completed,
      title: 'Completed',
      icon: CheckCircle2,
      glow: 'rgb(16 185 129)',
    },
    {
      key: 'incomplete',
      count: statusSummary.incomplete,
      title: 'Not completed',
      icon: CircleAlert,
      glow: 'rgb(249 115 22)',
    },
  ] as const;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Status summary (counts only — filter via Where → Status) */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {summaryItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.key}
                className={cn(
                  'relative overflow-hidden rounded-2xl border bg-[var(--glass-bg)] p-4',
                  'border-[var(--glass-border)] shadow-[var(--shadow-glass-value)]',
                  'dark:border-white/[0.06]'
                )}
                style={{
                  boxShadow: `0 0 0 1px ${item.glow}18, var(--shadow-glass-value)`,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">{item.title}</p>
                    <p className="mt-1.5 text-2xl font-bold tracking-tight text-foreground tabular-nums">
                      {item.count}
                    </p>
                  </div>
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-foreground/75"
                    style={{ backgroundColor: `${item.glow}22` }}
                  >
                    <Icon className="size-4" strokeWidth={2} />
                  </span>
                </div>
              </div>
            );
          })}
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
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex min-w-[180px] flex-1 flex-col gap-1.5 sm:max-w-[280px]">
                  <label className="text-xs font-medium text-muted-foreground">Search</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      placeholder="Anything on the job…"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      className="pl-9 pr-9"
                      aria-label="Search jobs"
                    />
                    {searchInput.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          lastPushedSearch.current = '';
                          setSearchInput('');
                          updateParams({ search: undefined });
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-foreground"
                        aria-label="Clear search"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex min-w-[200px] max-w-[min(100%,280px)] flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Scheduled date</label>
                  <JobsDateRangeFilter
                    dateFrom={initialFilters.date_from}
                    dateTo={initialFilters.date_to}
                    onChange={({ date_from, date_to }) => updateParams({ date_from, date_to })}
                  />
                </div>
                <div className="flex min-w-[200px] max-w-[min(100%,280px)] flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Import batch</label>
                  <SearchableSelect
                    value={activeBatchId ?? '__all__'}
                    onValueChange={(v) => {
                      if (v === '__all__') updateParams({ batchId: undefined });
                      else updateParams({ batchId: v });
                    }}
                    placeholder="All batches"
                    searchPlaceholder="Search batch..."
                    className="h-10 w-full"
                    options={[
                      { value: '__all__', label: 'All batches' },
                      ...sortedBatchFilterOptions.map((b) => {
                        const liveTotal =
                          b.pending +
                          b.pending_send +
                          b.assigned +
                          b.in_progress +
                          b.paused +
                          b.completed;
                        return {
                          value: b.id,
                          label: `${b.file_name ?? 'Unnamed import'} (${liveTotal})`,
                        };
                      }),
                    ]}
                  />
                </div>
                <div className="flex items-center gap-1 rounded-md border border-border/80 p-0.5">
                  <Button
                    variant={
                      !initialFilters.view || initialFilters.view === 'list'
                        ? 'secondary'
                        : 'ghost'
                    }
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() =>
                      updateParams(
                        initialFilters.view === 'batches'
                          ? { view: 'list', batchId: undefined }
                          : { view: 'list' }
                      )
                    }
                  >
                    <List className="size-3.5" />
                    List
                  </Button>
                  <Button
                    variant={initialFilters.view === 'batches' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => updateParams({ view: 'batches', batchId: undefined })}
                  >
                    <Layers className="size-3.5" />
                    Batches
                  </Button>
                </div>
                <div className="ml-auto flex items-center gap-2 self-end">
                  {hasFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        lastPushedSearch.current = '';
                        lastPushedFieldFilters.current = '[]';
                        setSearchInput('');
                        setFilterRows([newFilterRow()]);
                        rememberJobsListState('', []);
                        router.push('/jobs', { scroll: false });
                      }}
                    >
                      Clear filters
                    </Button>
                  )}
                  {!isBrowsingBatchesGrid && (
                    <JobsColumnsPicker visibleColumns={visibleColumns} onToggle={toggleColumn} />
                  )}
                  <ExportJobsButton jobs={initialJobs} totalCount={totalCount} filters={initialFilters} />
                </div>
              </div>

              <div className="space-y-2 border-t border-border/60 pt-3">
                {filterRows.map((row, index) => {
                  const valueOptions = row.field ? valuesByField[row.field] ?? [] : [];
                  return (
                    <div key={row.id} className="flex flex-wrap items-end gap-3">
                      <div className="flex min-w-[160px] max-w-[min(100%,240px)] flex-col gap-1.5">
                        {index === 0 ? (
                          <label className="text-xs font-medium text-muted-foreground">Where</label>
                        ) : (
                          <label className="text-xs font-medium text-muted-foreground">And</label>
                        )}
                        <SearchableSelect
                          value={row.field ?? '__none__'}
                          onValueChange={(v) => {
                            const field = v === '__none__' ? null : v;
                            if (field) void ensureValuesForField(field);
                            updateFilterRow(row.id, { field, value: null });
                          }}
                          placeholder="Choose field"
                          searchPlaceholder="Search fields…"
                          className="h-10 w-full"
                          options={[
                            { value: '__none__', label: 'Any field' },
                            ...fieldFilterOptions,
                          ]}
                        />
                      </div>
                      <div className="flex min-w-[160px] max-w-[min(100%,240px)] flex-col gap-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Is</label>
                        <SearchableSelect
                          value={row.value ?? '__none__'}
                          onValueChange={(v) => {
                            updateFilterRow(row.id, {
                              value: v === '__none__' ? null : v,
                            });
                          }}
                          placeholder={row.field ? 'Choose value' : 'Pick a field first'}
                          searchPlaceholder="Search values…"
                          className="h-10 w-full"
                          disabled={!row.field}
                          options={[
                            { value: '__none__', label: 'Any value' },
                            ...valueOptions.map((v) => ({
                              value: v.value,
                              label: v.label,
                            })),
                          ]}
                        />
                      </div>
                      {(filterRows.length > 1 || row.field || row.value) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-10 px-2 text-muted-foreground"
                          onClick={() => removeFilterRow(row.id)}
                          aria-label="Remove filter"
                        >
                          <X className="size-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
                {filterRows.length < MAX_FIELD_FILTERS && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={addFilterRow}
                  >
                    <Plus className="size-3.5" />
                    Add filter
                  </Button>
                )}
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

        <Dialog open={sendSelectedOpen} onOpenChange={setSendSelectedOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                Send {sendableSelectedIds.length} job
                {sendableSelectedIds.length === 1 ? '' : 's'} to workers?
              </DialogTitle>
              <DialogDescription>
                Each worker will be notified in the app and the job marked as assigned.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setSendSelectedOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleSendSelected()}
                disabled={isSendingSelected}
                className="bg-cyan-600 text-white hover:bg-cyan-700"
              >
                {isSendingSelected ? <Loader2 className="size-4 animate-spin" /> : null}
                Send {sendableSelectedIds.length} job{sendableSelectedIds.length === 1 ? '' : 's'}
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
          ) : initialFilters.view === 'batches' && !activeBatchId && !activeCustomerId ? (
            <div className="p-4">
              <BatchesCustomerView batches={batches} />
            </div>
          ) : initialFilters.view === 'batches' && !activeBatchId && activeCustomerId ? (
            <div className="p-4">
              <div className="mb-3">
                <button
                  type="button"
                  className="text-sm text-primary hover:underline"
                  onClick={() => updateParams({ customer_id: undefined })}
                >
                  ← All customers
                </button>
                <p className="mt-1 text-sm font-medium text-foreground">{activeCustomerName}</p>
              </div>
              <BatchesView batches={customerBatches} />
            </div>
          ) : (
            <>
              {activeBatch ? (
                <div className="border-b border-border/70 px-4 py-3">
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={() => updateParams({ batchId: undefined })}
                  >
                    {activeCustomerId ? '← All batches' : '← All customers'}
                  </button>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {activeBatch.file_name ?? 'Unnamed import batch'}
                  </p>
                </div>
              ) : null}
              <div className="flex max-h-[calc(100vh-14rem)] min-h-[320px] flex-col">
                {selectedIds.size > 0 && (
                  <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/80 bg-primary/5 px-4 py-2">
                    <span className="text-sm font-medium">{selectedIds.size} selected</span>
                    {sendableSelectedIds.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-cyan-700 hover:text-cyan-800 dark:text-cyan-400 dark:hover:text-cyan-300"
                        onClick={() => setSendSelectedOpen(true)}
                      >
                        <RadioTower className="size-4" />
                        Send selected ({sendableSelectedIds.length})
                      </Button>
                    )}
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
                        {visibleColumns.has('customer') && (
                          <TableHead className="text-muted-foreground">Customer</TableHead>
                        )}
                        {visibleColumns.has('address') && (
                          <TableHead className="text-muted-foreground">Address</TableHead>
                        )}
                        {visibleColumns.has('postcode') && (
                          <TableHead className="text-muted-foreground">Postcode</TableHead>
                        )}
                        {visibleColumns.has('worker') && (
                          <TableHead className="text-muted-foreground">Worker</TableHead>
                        )}
                        {visibleColumns.has('scheduled') && (
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
                        )}
                        {visibleColumns.has('priority') && (
                          <TableHead className="text-muted-foreground">Priority</TableHead>
                        )}
                        {visibleColumns.has('status') && (
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
                        )}
                        {visibleColumns.has('skills') && (
                          <TableHead className="text-muted-foreground">Skills</TableHead>
                        )}
                        {visibleColumns.has('created_at') && (
                          <TableHead className="text-muted-foreground">Created</TableHead>
                        )}
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
                          onClick={() => {
                            const committed = committedFiltersFromRows(filterRows);
                            router.push(
                              jobDetailHref(job.id, searchParams.toString(), committed)
                            );
                          }}
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
                              onClick={(e) => {
                                e.stopPropagation();
                                rememberJobsListState(
                                  searchParams.toString(),
                                  committedFiltersFromRows(filterRows)
                                );
                              }}
                            >
                              {job.reference_number || job.id.slice(0, 8)}
                            </Link>
                          </TableCell>
                          {visibleColumns.has('customer') && (
                            <TableCell className="max-w-[200px] truncate text-muted-foreground">
                              {job.customer_name ?? (
                                <span className="text-muted-foreground/70">—</span>
                              )}
                            </TableCell>
                          )}
                          {visibleColumns.has('address') && (
                            <TableCell className="max-w-[240px] text-muted-foreground">
                              <div className="truncate">{truncateAddress(job.address, 44)}</div>
                              {job.match_pills && job.match_pills.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {job.match_pills.map((pill) => (
                                    <span
                                      key={pill.label}
                                      className="inline-flex max-w-full truncate rounded-md border border-border/80 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                                      title={pill.label}
                                    >
                                      {pill.label}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          )}
                          {visibleColumns.has('postcode') && (
                            <TableCell className="text-muted-foreground">
                              {job.postcode || <span className="text-muted-foreground/70">—</span>}
                            </TableCell>
                          )}
                          {visibleColumns.has('worker') && (
                            <TableCell>
                              {job.worker_name && job.assigned_worker_id ? (
                                <Link
                                  href={`/workers/${job.assigned_worker_id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="hover:text-primary hover:underline"
                                >
                                  {job.worker_name}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground">Unassigned</span>
                              )}
                            </TableCell>
                          )}
                          {visibleColumns.has('scheduled') && (
                            <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                              {formatScheduledDateTime(
                                job.scheduled_date,
                                job.scheduled_time,
                                job.end_time
                              )}
                            </TableCell>
                          )}
                          {visibleColumns.has('priority') && (
                            <TableCell>
                              <PriorityBadge priority={job.priority} />
                            </TableCell>
                          )}
                          {visibleColumns.has('status') && (
                            <TableCell>
                              {job.status === 'pending_send' ? (
                                <SendJobBadge
                                  jobId={job.id}
                                  armed={armedSendId === job.id}
                                  sending={sendingSingleId === job.id}
                                  onArm={armSend}
                                  onConfirm={(id) => void confirmSend(id)}
                                />
                              ) : (
                                <StatusBadge status={job.status} />
                              )}
                            </TableCell>
                          )}
                          {visibleColumns.has('skills') && (
                            <TableCell className="max-w-[200px]">
                              {job.required_skills && job.required_skills.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {job.required_skills.map((skill) => (
                                    <span
                                      key={skill}
                                      className="inline-flex max-w-full truncate rounded-md border border-border/80 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                                    >
                                      {skill}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          )}
                          {visibleColumns.has('created_at') && (
                            <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                              {formatDateOnly(job.created_at)}
                            </TableCell>
                          )}
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
      <FloatingAddButton href="/jobs/new" label="New Job" desktopLabel={false} />
    </TooltipProvider>
  );
}
