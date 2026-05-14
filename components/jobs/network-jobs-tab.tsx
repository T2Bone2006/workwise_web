'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { NetworkDispatchedJobRow } from '@/lib/data/network';
import { JOB_STATUS_DISPLAY } from '@/lib/job-status-display';
import { cn } from '@/lib/utils';
import { createBrowserClient } from '@/lib/supabase/client';

interface NetworkJobsTabProps {
  initialJobs: NetworkDispatchedJobRow[];
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export function NetworkJobsTab({ initialJobs }: NetworkJobsTabProps) {
  const [jobs, setJobs] = useState<NetworkDispatchedJobRow[]>(initialJobs);
  const canonicalIds = useMemo(
    () =>
      initialJobs
        .map((row) => row.canonical_job_id)
        .filter((id): id is string => !!id),
    [initialJobs]
  );

  useEffect(() => {
    setJobs(initialJobs);
  }, [initialJobs]);

  useEffect(() => {
    if (canonicalIds.length === 0) return;
    const supabase = createBrowserClient();
    const filter = `id=in.(${canonicalIds.join(',')})`;
    const channel = supabase
      .channel(`network-dispatched-jobs-${canonicalIds.join('-')}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter,
        },
        (payload) => {
          const updatedStatus = (payload.new as { status?: string }).status ?? null;
          const updatedAssignedWorkerId =
            (payload.new as { assigned_worker_id?: string | null }).assigned_worker_id ?? null;
          const updatedJobId = (payload.new as { id?: string }).id;
          if (!updatedJobId) return;

          setJobs((prev) =>
            prev.map((row) =>
              row.canonical_job_id === updatedJobId
                ? {
                    ...row,
                    status: updatedStatus,
                    assigned_worker_id: updatedAssignedWorkerId,
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

  return (
    <Card
      className={cn(
        'glass-card overflow-hidden border-border/80 transition-all duration-300',
        'dark:border-white/[0.06]',
        'backdrop-blur-[var(--blur-glass)] shadow-[var(--shadow-glass-value)]'
      )}
    >
      <CardContent className="p-0">
        {jobs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No jobs have been sent to the network yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference #</TableHead>
                <TableHead>Receiving business</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned worker</TableHead>
                <TableHead>Scheduled date</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((row) => {
                const statusMeta = row.status ? JOB_STATUS_DISPLAY[row.status as keyof typeof JOB_STATUS_DISPLAY] : null;
                const statusLabel = statusMeta?.label ?? row.status ?? '—';
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {row.originating_reference_number ?? row.reference_number ?? '—'}
                    </TableCell>
                    <TableCell>{row.other_tenant_name ?? row.receiving_tenant_name ?? '—'}</TableCell>
                    <TableCell>{statusLabel}</TableCell>
                    <TableCell>{row.assigned_worker_name ?? 'Unassigned'}</TableCell>
                    <TableCell>{formatDate(row.scheduled_date)}</TableCell>
                    <TableCell className="text-right">
                      {row.canonical_job_id ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/jobs/${row.canonical_job_id}`}>View</Link>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
