'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { JOB_STATUS_DISPLAY } from '@/lib/job-status-display';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import type { ImportBatchRow, JobStatus } from '@/lib/data/jobs';
import type { NetworkConnectionRow, NetworkDispatchedJobRow } from '@/lib/data/network';
import { createBrowserClient } from '@/lib/supabase/client';

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;

type MonitorStatus = JobStatus | 'declined';

const STATUS_OPTIONS: Array<{ value: 'all' | MonitorStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: JOB_STATUS_DISPLAY.pending.label },
  { value: 'pending_send', label: JOB_STATUS_DISPLAY.pending_send.label },
  { value: 'assigned', label: JOB_STATUS_DISPLAY.assigned.label },
  { value: 'in_progress', label: JOB_STATUS_DISPLAY.in_progress.label },
  { value: 'paused', label: 'Paused' },
  { value: 'declined', label: JOB_STATUS_DISPLAY.declined.label },
  { value: 'completed', label: JOB_STATUS_DISPLAY.completed.label },
  { value: 'cancelled', label: JOB_STATUS_DISPLAY.cancelled.label },
];

function StatusBadge({ status }: { status: MonitorStatus | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const meta = JOB_STATUS_DISPLAY[status];
  const label =
    status === 'declined' ? 'Declined — returned to queue' : (meta?.label ?? status);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
            meta?.badgeClass
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Live from canonical job</TooltipContent>
    </Tooltip>
  );
}

interface MonitorViewProps {
  initialJobs: NetworkDispatchedJobRow[];
  totalCount: number;
  initialFilters: {
    search?: string;
    status?: MonitorStatus;
    receiving_tenant_id?: string;
    batchId?: string;
    page?: number;
  };
  connections: NetworkConnectionRow[];
  batches: ImportBatchRow[];
}

function formatScheduledDate(dateStr: string | null) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString();
}

export function MonitorView({
  initialJobs,
  totalCount,
  initialFilters,
  connections,
  batches,
}: MonitorViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(initialFilters.search ?? '');
  const [isNavigating, setIsNavigating] = useState(false);
  const [jobs, setJobs] = useState<NetworkDispatchedJobRow[]>(initialJobs);

  useEffect(() => {
    setJobs(initialJobs);
  }, [initialJobs]);

  const canonicalIds = useMemo(
    () => jobs.map((row) => row.canonical_job_id).filter((id): id is string => !!id),
    [jobs]
  );

  useEffect(() => {
    if (canonicalIds.length === 0) return;
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`monitor-jobs-${canonicalIds.join('-')}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `id=in.(${canonicalIds.join(',')})`,
        },
        (payload) => {
          const updated = payload.new as {
            id?: string;
            status?: MonitorStatus | null;
            assigned_worker_id?: string | null;
          };
          if (!updated.id) return;
          setJobs((prev) =>
            prev.map((row) =>
              row.canonical_job_id === updated.id
                ? {
                    ...row,
                    status: updated.status ?? null,
                    assigned_worker_id: updated.assigned_worker_id ?? null,
                  }
                : row
            )
          );
        }
      )
      .subscribe();
    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [canonicalIds]);

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      const hasFilterChange = Object.keys(updates).some((key) => key !== 'page');
      if (hasFilterChange) next.delete('page');
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      router.push(`/monitor?${next.toString()}`, { scroll: false });
      setIsNavigating(true);
    },
    [router, searchParams]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      const current = searchParams.get('search') ?? '';
      if (searchInput.trim() !== current) {
        updateParams({ search: searchInput.trim() || undefined });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput, searchParams, updateParams]);

  useEffect(() => {
    setSearchInput(initialFilters.search ?? '');
    setIsNavigating(false);
  }, [initialFilters, initialJobs]);

  const currentPage = Math.max(1, initialFilters.page ?? 1);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  const showPagination = totalCount > PAGE_SIZE;
  const isEmpty = jobs.length === 0;
  const hasFilters = !!(
    initialFilters.search ||
    initialFilters.status ||
    initialFilters.receiving_tenant_id ||
    initialFilters.batchId
  );

  const activeConnections = useMemo(
    () =>
      connections
        .filter((connection) => connection.other_tenant_id && connection.status === 'active')
        .sort((a, b) =>
          (a.other_tenant_name ?? '').localeCompare(b.other_tenant_name ?? '')
        ),
    [connections]
  );

  const sortedBatches = useMemo(
    () => [...batches].sort((a, b) => (a.file_name ?? '').localeCompare(b.file_name ?? '')),
    [batches]
  );

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <PageGradientHeader
          title="Monitor"
          subtitle={`Tracking ${totalCount.toLocaleString()} network-dispatched jobs`}
        />

        <Card
          className={cn(
            'glass-card overflow-hidden border-border/80 transition-all duration-300',
            'dark:border-white/[0.06]',
            'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
          )}
        >
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="relative min-w-[200px] flex-1 sm:max-w-[320px]">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search reference or address"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select
                value={initialFilters.status ?? 'all'}
                onValueChange={(value) =>
                  updateParams({ status: value === 'all' ? undefined : value })
                }
              >
                <SelectTrigger className="h-10 w-[180px]">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SearchableSelect
                value={initialFilters.receiving_tenant_id ?? 'all'}
                onValueChange={(value) =>
                  updateParams({
                    receiving_tenant_id: value === 'all' ? undefined : value,
                  })
                }
                placeholder="Sent to"
                searchPlaceholder="Search business..."
                className="h-10 w-[220px]"
                options={[
                  { value: 'all', label: 'Sent to: all' },
                  ...activeConnections.map((connection) => ({
                    value: connection.other_tenant_id as string,
                    label: connection.other_tenant_name ?? 'Unknown business',
                  })),
                ]}
              />
              <Select
                value={initialFilters.batchId ?? 'all'}
                onValueChange={(value) =>
                  updateParams({ batchId: value === 'all' ? undefined : value })
                }
              >
                <SelectTrigger className="h-10 w-[220px]">
                  <SelectValue placeholder="Batch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All batches</SelectItem>
                  {sortedBatches
                    .filter((batch) => batch.id === 'ungrouped' || !!batch.import_source_id)
                    .map((batch) => (
                      <SelectItem
                        key={batch.id}
                        value={batch.id === 'ungrouped' ? 'ungrouped' : (batch.import_source_id as string)}
                      >
                        {batch.file_name ?? 'Unnamed batch'}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {hasFilters ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchInput('');
                    router.push('/monitor', { scroll: false });
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card
          className={cn(
            'glass-card overflow-hidden border-border/80 transition-all duration-300',
            'dark:border-white/[0.06]',
            'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
          )}
        >
          {isNavigating ? (
            <div className="flex min-h-[280px] items-center justify-center p-8">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="size-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading dispatched jobs…</p>
              </div>
            </div>
          ) : isEmpty ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center">
              <h3 className="text-lg font-semibold text-foreground">
                {hasFilters
                  ? 'No dispatched jobs match your filters'
                  : 'No dispatched jobs yet'}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {hasFilters
                  ? 'Try clearing one or more filters.'
                  : 'Jobs you send to connected businesses will appear here.'}
              </p>
            </div>
          ) : (
            <>
              <div className="max-h-[calc(100vh-18rem)] overflow-auto">
                <table className="w-full caption-bottom text-sm">
                  <TableHeader>
                    <TableRow className="border-border/80 hover:bg-transparent">
                      <TableHead>Our ref</TableHead>
                      <TableHead>Sent to</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Assigned to</TableHead>
                      <TableHead>Scheduled date</TableHead>
                      <TableHead className="text-right">View</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job, index) => (
                      <TableRow
                        key={job.id}
                        className={cn(
                          'border-border/60 transition-all duration-200',
                          index % 2 === 1 && 'bg-muted/20 dark:bg-muted/10'
                        )}
                      >
                        <TableCell className="font-medium">
                          {job.originating_reference_number ?? '—'}
                        </TableCell>
                        <TableCell>{job.receiving_tenant_name ?? '—'}</TableCell>
                        <TableCell className="max-w-[280px] truncate text-muted-foreground">
                          {job.address ?? '—'}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={(job.status as MonitorStatus | null) ?? null} />
                        </TableCell>
                        <TableCell>{job.assigned_worker_name ?? 'Unassigned'}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatScheduledDate(job.scheduled_date)}
                        </TableCell>
                        <TableCell className="text-right">
                          {job.canonical_job_id ? (
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/jobs/${job.canonical_job_id}`}>View</Link>
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
              {showPagination ? (
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
              ) : null}
            </>
          )}
        </Card>
      </div>
    </TooltipProvider>
  );
}
