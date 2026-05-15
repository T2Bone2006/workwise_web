'use client';

import { useEffect, useState } from 'react';
import { JobDetailHeader } from '@/components/jobs/job-detail-header';
import { JobDetailView, type JobDetailMapData } from '@/components/jobs/job-detail-view';
import type { JobDetailJob, JobStatusHistoryEntry } from '@/lib/types/job-detail';
import type { JobAttachmentRow } from '@/lib/utils/job-attachments';
import type { TenantSkillRow } from '@/lib/actions/skills';
import type { JobStatus } from '@/lib/data/jobs';
import { createBrowserClient } from '@/lib/supabase/client';

interface WorkerOption {
  id: string;
  full_name: string;
}

interface JobOriginRealtimeViewProps {
  initialJob: JobDetailJob;
  initialStatusHistory: JobStatusHistoryEntry[];
  workers: WorkerOption[];
  tenantSkills: TenantSkillRow[];
  mapData?: JobDetailMapData | null;
  industryData?: unknown;
  completionNotes?: string;
  attachmentPhotos: { before: JobAttachmentRow[]; after: JobAttachmentRow[] };
  receivingBusinessName?: string | null;
  isNetworkDispatched?: boolean;
}

export function JobOriginRealtimeView({
  initialJob,
  initialStatusHistory,
  workers,
  tenantSkills,
  mapData,
  industryData,
  completionNotes,
  attachmentPhotos,
  receivingBusinessName,
  isNetworkDispatched = false,
}: JobOriginRealtimeViewProps) {
  const [job, setJob] = useState<JobDetailJob>(initialJob);
  const [statusHistory, setStatusHistory] = useState<JobStatusHistoryEntry[]>(initialStatusHistory);

  useEffect(() => {
    setJob(initialJob);
    setStatusHistory(initialStatusHistory);
  }, [initialJob, initialStatusHistory]);

  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`origin-job-${initialJob.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `id=eq.${initialJob.id}`,
        },
        (payload) => {
          const nextStatus = (payload.new as { status?: JobStatus }).status;
          const nextAssignedWorkerId =
            (payload.new as { assigned_worker_id?: string | null }).assigned_worker_id ?? null;

          setJob((prev) => {
            const prevStatus = prev.status;
            const nextWorker = nextAssignedWorkerId
              ? prev.worker && prev.worker.id === nextAssignedWorkerId
                ? prev.worker
                : null
              : null;

            if (nextStatus && nextStatus !== prevStatus) {
              supabase
                .from('job_status_history')
                .select('*')
                .eq('job_id', prev.id)
                .order('created_at', { ascending: false })
                .then(({ data }) => {
                  if (!data) return;
                  setStatusHistory(
                    data.map((row: Record<string, unknown>) => ({
                      id: row.id as string,
                      job_id: row.job_id as string,
                      from_status: (row.from_status as string) ?? null,
                      to_status: (row.to_status as string) ?? '',
                      changed_by_user_id: (row.changed_by_user_id as string) ?? null,
                      changed_by_worker_id: (row.changed_by_worker_id as string) ?? null,
                      notes: (row.notes as string) ?? null,
                      created_at: row.created_at as string,
                    }))
                  );
                });
            }

            return {
              ...prev,
              status: nextStatus ?? prev.status,
              assigned_worker_id: nextAssignedWorkerId,
              worker: nextWorker,
            };
          });
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [initialJob.id]);

  return (
    <div className="space-y-6">
      <JobDetailHeader
        jobId={job.id}
        referenceNumber={job.reference_number}
        status={job.status}
        priority={job.priority}
        createdAt={job.created_at}
        hideDeleteAction={isNetworkDispatched}
      />
      <JobDetailView
        job={job}
        statusHistory={statusHistory}
        workers={workers}
        tenantSkills={tenantSkills}
        mapData={mapData}
        industryData={industryData}
        completionNotes={completionNotes}
        attachmentPhotos={attachmentPhotos}
        isNetworkOriginView={true}
        receivingBusinessName={receivingBusinessName}
        isNetworkDispatched={isNetworkDispatched}
      />
    </div>
  );
}
