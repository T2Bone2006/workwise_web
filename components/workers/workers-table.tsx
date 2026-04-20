'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus,
  UserPlus,
  Search,
  MoreHorizontal,
  Phone,
  Mail,
  Eye,
  Pencil,
  Trash2,
  Loader2,
  ChevronDown,
  Filter,
  X,
  Check,
  Download,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { SKILL_LABELS } from '@/lib/constants/skills';
import type {
  WorkerRow as WorkerRowType,
  WorkerInviteStatus,
  WorkersFilters,
  WorkerStatus,
  WorkerType,
} from '@/lib/types/worker';
import { deleteWorker, bulkUpdateWorkerStatus, bulkDeleteWorkers, getWorkerActiveJobCount } from '@/lib/actions/workers';
import { InviteWorkerDialog } from '@/components/workers/invite-worker-dialog';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 300;

const STATUS_OPTIONS: { value: WorkerStatus; label: string }[] = [
  { value: 'available', label: 'Available' },
  { value: 'busy', label: 'Busy' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'off_duty', label: 'Off Duty' },
];

const WORKER_TYPE_OPTIONS: { value: WorkerType; label: string }[] = [
  { value: 'company_subcontractor', label: 'Company Subcontractor' },
  { value: 'platform_solo', label: 'Platform Solo' },
  { value: 'both', label: 'Both' },
];

const statusBadgeClass: Record<WorkerStatus, string> = {
  available:
    'border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 shadow-[0_0_12px_-2px_rgba(16,185,129,0.25)]',
  busy: 'border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-400 shadow-[0_0_12px_-2px_rgba(245,158,11,0.25)]',
  unavailable:
    'border-red-400/60 bg-red-500/10 text-red-700 dark:text-red-400 shadow-[0_0_12px_-2px_rgba(239,68,68,0.25)]',
  off_duty:
    'border-slate-400/50 bg-slate-500/10 text-slate-600 dark:text-slate-400 shadow-[0_0_8px_-2px_rgba(100,116,139,0.2)]',
};

const workerTypeBadgeClass: Record<WorkerType, string> = {
  company_subcontractor: 'border-blue-400/50 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  platform_solo: 'border-violet-400/50 bg-violet-500/10 text-violet-700 dark:text-violet-400',
  both: 'border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
};

function StatusBadge({ status }: { status: WorkerStatus | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const label = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm',
        statusBadgeClass[status]
      )}
    >
      {label}
    </span>
  );
}

function InviteStatusBadge({ status }: { status: WorkerInviteStatus }) {
  if (status === 'pending') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm',
          'border-amber-400/60 bg-amber-500/10 text-amber-800 dark:text-amber-300'
        )}
      >
        Pending invite
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm',
        'border-emerald-400/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-400'
      )}
    >
      Active
    </span>
  );
}

function WorkerTypeBadge({ type }: { type: WorkerType | null }) {
  if (!type) return <span className="text-muted-foreground">—</span>;
  const label = WORKER_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm',
        workerTypeBadgeClass[type]
      )}
    >
      {label}
    </span>
  );
}

function SkillsBadges({ skills }: { skills: string[] | null }) {
  if (!skills?.length) return <span className="text-muted-foreground">—</span>;
  const show = skills.slice(0, 3);
  const rest = skills.length - 3;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {show.map((key) => (
        <span
          key={key}
          className="inline-flex rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 text-xs"
        >
          {SKILL_LABELS[key] ?? key}
        </span>
      ))}
      {rest > 0 && (
        <span className="text-xs text-muted-foreground">+{rest} more</span>
      )}
    </div>
  );
}

export interface WorkersTableProps {
  workers: WorkerRowType[];
  initialFilters: WorkersFilters;
  allSkillsInUse: string[];
  fetchError: Error | null;
}

export function WorkersTable({
  workers,
  initialFilters,
  allSkillsInUse,
  fetchError,
}: WorkersTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(initialFilters.search ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);
  const [skillsPopoverOpen, setSkillsPopoverOpen] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [deleteConfirmWorker, setDeleteConfirmWorker] = useState<WorkerRowType | null>(null);
  const [deleteActiveCount, setDeleteActiveCount] = useState<number>(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const stripScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  const statusFilter = initialFilters.status;
  const statusArray = Array.isArray(statusFilter)
    ? statusFilter
    : statusFilter
      ? [statusFilter]
      : [];
  const hasSkillsFilter = initialFilters.has_skills;
  const hasSkillsArray = Array.isArray(hasSkillsFilter)
    ? hasSkillsFilter
    : hasSkillsFilter
      ? [hasSkillsFilter]
      : [];

  const toggleSelectAll = () => {
    if (selectedIds.size >= workers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(workers.map((w) => w.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  useEffect(() => {
    setSearchInput(initialFilters.search ?? '');
  }, [initialFilters.search]);

  useEffect(() => {
    if (fetchError) {
      toast.error('Failed to load workers', { description: fetchError.message });
    }
  }, [fetchError]);

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      router.push(`/workers?${next.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const toggleStatus = (s: WorkerStatus) => {
    const next = statusArray.includes(s)
      ? statusArray.filter((x) => x !== s)
      : [...statusArray, s];
    updateParams({ status: next.length ? next.join(',') : undefined });
    setStatusPopoverOpen(false);
  };

  const toggleSkill = (skill: string) => {
    const next = hasSkillsArray.includes(skill)
      ? hasSkillsArray.filter((x) => x !== skill)
      : [...hasSkillsArray, skill];
    updateParams({ has_skills: next.length ? next.join(',') : undefined });
    setSkillsPopoverOpen(false);
  };

  const sortCol = initialFilters.sort ?? 'full_name';
  const sortDir = initialFilters.sort_dir ?? 'asc';
  const toggleSort = (col: WorkersFilters['sort']) => {
    if (!col) return;
    const nextDir = sortCol === col && sortDir === 'asc' ? 'desc' : 'asc';
    updateParams({ sort: col, sort_dir: nextDir });
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

  const hasFilters = !!(
    initialFilters.search ||
    statusArray.length ||
    initialFilters.worker_type ||
    hasSkillsArray.length
  );

  const openDeleteConfirm = async (worker: WorkerRowType) => {
    setDeleteConfirmWorker(worker);
    const count = await getWorkerActiveJobCount(worker.id);
    setDeleteActiveCount(count);
  };

  const handleDelete = async () => {
    if (!deleteConfirmWorker) return;
    setIsDeleting(true);
    const result = await deleteWorker(deleteConfirmWorker.id);
    setIsDeleting(false);
    setDeleteConfirmWorker(null);
    if (result.success) {
      toast.success('Worker deleted');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to delete worker');
    }
  };

  const handleBulkStatusUpdate = async (status: WorkerStatus) => {
    if (!selectedIds.size) return;
    setIsBulkUpdating(true);
    const result = await bulkUpdateWorkerStatus(Array.from(selectedIds), status);
    setIsBulkUpdating(false);
    setBulkStatusOpen(false);
    if (result.success) {
      setSelectedIds(new Set());
      toast.success(`Status updated for ${selectedIds.size} worker(s)`);
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to update status');
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    setIsBulkDeleting(true);
    const result = await bulkDeleteWorkers(Array.from(selectedIds));
    setIsBulkDeleting(false);
    setBulkDeleteOpen(false);
    if (result.success) {
      setSelectedIds(new Set());
      toast.success('Selected workers deleted');
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to delete workers');
    }
  };

  const handleExportSelected = () => {
    const selected = workers.filter((w) => selectedIds.has(w.id));
    const headers = ['Name', 'Phone', 'Email', 'Postcode', 'Type', 'Status', 'Skills'];
    const rows = selected.map((w) => [
      w.full_name,
      w.phone ?? '',
      w.email ?? '',
      w.home_postcode ?? '',
      w.worker_type ?? '',
      w.status ?? '',
      (w.skills ?? []).map((s) => SKILL_LABELS[s] ?? s).join('; '),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workers-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Export downloaded');
  };

  const isEmpty = workers.length === 0 && !fetchError;

  // Measure table content width for floating horizontal scrollbar
  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setTableScrollWidth(el.scrollWidth);
    });
    ro.observe(el);
    setTableScrollWidth(el.scrollWidth);
    return () => ro.disconnect();
  }, [workers.length]);

  // Sync horizontal scroll: strip <-> table
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

  const skillsForFilter = useMemo(() => {
    const set = new Set<string>(allSkillsInUse);
    SKILL_LABELS && Object.keys(SKILL_LABELS).forEach((k) => set.add(k));
    return Array.from(set);
  }, [allSkillsInUse]);

  return (
    <div className="space-y-4">
      {/* Filters + Add Worker */}
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
              <div className="relative flex-1 min-w-[180px] sm:max-w-[260px]">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Name, phone, email..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-9"
                  aria-label="Search workers"
                />
              </div>
              <Popover open={statusPopoverOpen} onOpenChange={setStatusPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="default" className="gap-1.5">
                    <Filter className="size-3.5" />
                    Status
                    {statusArray.length > 0 && (
                      <span className="rounded-full bg-primary/20 px-1.5 text-xs">
                        {statusArray.length}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2" align="start">
                  {STATUS_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => toggleStatus(o.value)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                        statusArray.includes(o.value)
                          ? 'bg-primary/15 text-primary'
                          : 'hover:bg-muted'
                      )}
                    >
                      {statusArray.includes(o.value) ? '✓ ' : ''}
                      {o.label}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
              <Select
                value={initialFilters.worker_type ?? 'all'}
                onValueChange={(v) =>
                  updateParams(v === 'all' ? { worker_type: undefined } : { worker_type: v })
                }
              >
                <SelectTrigger className="w-[200px]" size="default">
                  <SelectValue placeholder="Worker type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {WORKER_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Popover open={skillsPopoverOpen} onOpenChange={setSkillsPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="default" className="gap-1.5">
                    Skills
                    {hasSkillsArray.length > 0 && (
                      <span className="rounded-full bg-primary/20 px-1.5 text-xs">
                        {hasSkillsArray.length}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="start">
                  {skillsForFilter.length === 0 ? (
                    <p className="px-2 py-2 text-sm text-muted-foreground">No skills in use yet</p>
                  ) : (
                    skillsForFilter.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleSkill(key)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                          hasSkillsArray.includes(key)
                            ? 'bg-primary/15 text-primary'
                            : 'hover:bg-muted'
                        )}
                      >
                        {hasSkillsArray.includes(key) ? '✓ ' : ''}
                        {SKILL_LABELS[key] ?? key}
                      </button>
                    ))
                  )}
                </PopoverContent>
              </Popover>
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchInput('');
                    router.push('/workers', { scroll: false });
                  }}
                >
                  Clear filters
                </Button>
              )}
              <div className="ml-auto flex shrink-0 flex-wrap gap-2">
                <InviteWorkerDialog>
                  <Button variant="outline" size="default" className="gap-1.5">
                    <UserPlus className="size-4" />
                    Invite worker
                  </Button>
                </InviteWorkerDialog>
                <Button variant="gradient" size="default" asChild>
                  <Link href="/workers/new">
                    <Plus className="size-4" />
                    Add Worker
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk delete confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.size} workers</DialogTitle>
            <DialogDescription>
              This cannot be undone. Workers with active jobs will not be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete Selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Table card */}
      <Card
        className={cn(
          'glass-card overflow-hidden border-border/80 transition-all duration-300',
          'dark:border-white/[0.06]',
          'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
        )}
      >
        {fetchError ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 p-8">
            <p className="text-center text-sm text-destructive">{fetchError.message}</p>
            <Button variant="outline" onClick={() => router.refresh()}>
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
                <Search className="size-8 text-primary" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">
                {hasFilters ? 'No workers match your filters' : 'No workers yet'}
              </h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                {hasFilters
                  ? 'Try clearing filters or changing your criteria.'
                  : 'Add your first worker to start assigning jobs.'}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <InviteWorkerDialog>
                  <Button variant="outline" size="lg" className="gap-1.5">
                    <UserPlus className="size-4" />
                    Invite worker
                  </Button>
                </InviteWorkerDialog>
                <Button variant="gradient" size="lg" asChild>
                  <Link href="/workers/new">
                    <Plus className="size-4" />
                    Add Worker
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop: toolbar + horizontal strip + table inside card; only table body scrolls */}
            <div className="hidden md:flex flex-col max-h-[calc(100vh-14rem)] min-h-[320px]">
              {/* 1. Toolbar at top of card when rows selected */}
              {selectedIds.size > 0 && (
                <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/80 bg-primary/5 px-4 py-2">
                  <span className="text-sm font-medium">
                    {selectedIds.size} selected
                  </span>
                  <Popover open={bulkStatusOpen} onOpenChange={setBulkStatusOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isBulkUpdating}
                        className="w-[160px] justify-between"
                      >
                        {isBulkUpdating ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <>
                            Update Status
                            <ChevronDown className="size-4" />
                          </>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-48 p-2" align="start">
                      {STATUS_OPTIONS.map((o) => (
                        <Button
                          key={o.value}
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start"
                          onClick={() => handleBulkStatusUpdate(o.value)}
                        >
                          {o.label}
                        </Button>
                      ))}
                    </PopoverContent>
                  </Popover>
                  <Button variant="outline" size="sm" onClick={handleExportSelected}>
                    <Download className="size-4" />
                    Export Selected
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="size-4" />
                    Delete Selected
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    <X className="size-4" />
                    Clear Selection
                  </Button>
                </div>
              )}
              {/* 2. Horizontal scroll strip - always visible at top of table area */}
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
              {/* 3. Table body - only this part scrolls (single scroll container so strip stays in sync) */}
              <div
                ref={tableScrollRef}
                className="min-h-0 flex-1 overflow-auto"
                onScroll={onTableScroll}
              >
                <table className="w-full caption-bottom text-sm">
                <TableHeader>
                  <TableRow className="border-border/80 hover:bg-transparent">
                    <TableHead className="w-10">
                      <button
                        type="button"
                        onClick={toggleSelectAll}
                        className="rounded border border-input p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Toggle all"
                      >
                        {selectedIds.size >= workers.length && workers.length > 0 ? (
                          <Check className="size-4 text-primary" />
                        ) : (
                          <span className="block size-4" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort('full_name')}
                        className="flex items-center font-medium"
                      >
                        Name
                        {sortCol === 'full_name' ? (
                          sortDir === 'asc' ? (
                            <span className="ml-1 text-xs">↑</span>
                          ) : (
                            <span className="ml-1 text-xs">↓</span>
                          )
                        ) : null}
                      </button>
                    </TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Invite</TableHead>
                    <TableHead>Postcode</TableHead>
                    <TableHead>Skills</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort('status')}
                        className="flex items-center font-medium"
                      >
                        Status
                        {sortCol === 'status' ? (
                          sortDir === 'asc' ? (
                            <span className="ml-1 text-xs">↑</span>
                          ) : (
                            <span className="ml-1 text-xs">↓</span>
                          )
                        ) : null}
                      </button>
                    </TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workers.map((worker) => (
                    <TableRow
                      key={worker.id}
                      onClick={() => router.push(`/workers/${worker.id}`)}
                      className="cursor-pointer border-border/60 transition-colors hover:bg-muted/40"
                    >
                      <TableCell
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSelect(worker.id)}
                          className="rounded border border-input p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {selectedIds.has(worker.id) ? (
                            <Check className="size-4 text-primary" />
                          ) : (
                            <span className="block size-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/workers/${worker.id}`}
                          className="font-medium text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {worker.full_name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {worker.phone ? (
                          <a
                            href={`tel:${worker.phone}`}
                            className="inline-flex items-center gap-1 text-sm hover:underline"
                          >
                            <Phone className="size-3.5" />
                            {worker.phone}
                          </a>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {worker.email ? (
                          <a
                            href={`mailto:${worker.email}`}
                            className="inline-flex items-center gap-1 text-sm hover:underline"
                          >
                            <Mail className="size-3.5" />
                            {worker.email}
                          </a>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <InviteStatusBadge status={worker.invite_status} />
                      </TableCell>
                      <TableCell>{worker.home_postcode ?? '—'}</TableCell>
                      <TableCell>
                        <SkillsBadges skills={worker.skills} />
                      </TableCell>
                      <TableCell>
                        <WorkerTypeBadge type={worker.worker_type} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={worker.status} />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                              <MoreHorizontal className="size-4" />
                              <span className="sr-only">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/workers/${worker.id}`}>
                                <Eye className="size-4" />
                                View Profile
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/workers/${worker.id}/edit`}>
                                <Pencil className="size-4" />
                                Edit
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => openDeleteConfirm(worker)}
                            >
                              <Trash2 className="size-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                </table>
              </div>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border/60">
              {workers.map((worker) => (
                <div
                  key={worker.id}
                  className="flex flex-col gap-2 p-4 transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleSelect(worker.id)}
                        className="shrink-0 rounded border border-input p-0.5"
                      >
                        {selectedIds.has(worker.id) ? (
                          <Check className="size-4 text-primary" />
                        ) : (
                          <span className="block size-4" />
                        )}
                      </button>
                      <Link
                        href={`/workers/${worker.id}`}
                        className="font-medium text-primary hover:underline truncate"
                      >
                        {worker.full_name}
                      </Link>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8 shrink-0">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/workers/${worker.id}`}>View Profile</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/workers/${worker.id}/edit`}>Edit</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => openDeleteConfirm(worker)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm text-muted-foreground pl-7">
                    {worker.phone && (
                      <a href={`tel:${worker.phone}`} className="inline-flex items-center gap-1 hover:underline">
                        <Phone className="size-3" /> {worker.phone}
                      </a>
                    )}
                    {worker.email && (
                      <a href={`mailto:${worker.email}`} className="inline-flex items-center gap-1 hover:underline">
                        <Mail className="size-3" /> {worker.email}
                      </a>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 pl-7">
                    <InviteStatusBadge status={worker.invite_status} />
                    <WorkerTypeBadge type={worker.worker_type} />
                    <StatusBadge status={worker.status} />
                    {worker.home_postcode && (
                      <span className="text-xs text-muted-foreground">{worker.home_postcode}</span>
                    )}
                  </div>
                  <div className="pl-7">
                    <SkillsBadges skills={worker.skills} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirmWorker} onOpenChange={(open) => !open && setDeleteConfirmWorker(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete worker</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {deleteConfirmWorker?.full_name}?
              {deleteActiveCount > 0 && (
                <span className="block mt-2 text-destructive font-medium">
                  This worker has {deleteActiveCount} active job(s). Reassign jobs first or delete will be blocked.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmWorker(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting || deleteActiveCount > 0}
            >
              {isDeleting ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
