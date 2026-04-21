'use client';

import dynamic from 'next/dynamic';
import { JobDetailDetailsCard } from '@/components/jobs/job-detail-details-card';
import { JobDetailSkillsCard } from '@/components/jobs/job-detail-skills-card';
import { JobStatusTimeline } from '@/components/jobs/job-status-timeline';
import { JobDetailCustomerCard } from '@/components/jobs/job-detail-customer-card';
import { JobDetailWorkerCard } from '@/components/jobs/job-detail-worker-card';
import { JobDetailActionsCard } from '@/components/jobs/job-detail-actions-card';
import { JobDetailJobReportCard } from '@/components/jobs/job-detail-job-report-card';
import { JobDetailCompletionNotes } from '@/components/jobs/job-detail-completion-notes';
import { JobDetailPhotosCard } from '@/components/jobs/job-detail-photos-card';
import { JobDetailCompletionSection } from '@/components/jobs/job-detail-completion-section';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { JobDetailJob, JobStatusHistoryEntry } from '@/lib/types/job-detail';
import type { JobAttachmentRow } from '@/lib/utils/job-attachments';
import { isIndustryDataEmpty } from '@/lib/utils/job-industry-data';

const JobLocationMap = dynamic(
  () => import('@/components/maps/job-location-map').then((mod) => mod.JobLocationMap),
  { ssr: false }
);

interface WorkerOption {
  id: string;
  full_name: string;
}

export interface JobDetailMapData {
  jobLocation: { address: string; postcode: string; lat: number; lng: number };
  workerLocation?: {
    name: string;
    postcode: string;
    lat: number;
    lng: number;
  };
  distance?: number;
}

interface JobDetailViewProps {
  job: JobDetailJob;
  statusHistory: JobStatusHistoryEntry[];
  workers: WorkerOption[];
  mapData?: JobDetailMapData | null;
  /** Set when the job report card should render, or when status is completed (completion section). */
  industryData?: unknown;
  completionNotes?: string;
  /** Before/after image attachments from `job_attachments` for this job. */
  attachmentPhotos: { before: JobAttachmentRow[]; after: JobAttachmentRow[] };
}

export function JobDetailView({
  job,
  statusHistory,
  workers,
  mapData,
  industryData,
  completionNotes,
  attachmentPhotos,
}: JobDetailViewProps) {
  const isCompleted = job.status === 'completed';
  const hasPhotoGroups =
    attachmentPhotos.before.length > 0 || attachmentPhotos.after.length > 0;
  const showJobReportCard =
    industryData !== undefined && !isCompleted && !isIndustryDataEmpty(industryData);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
      {/* Left column */}
      <div className="space-y-6">
        <JobDetailDetailsCard
          address={job.address}
          postcode={job.postcode}
          description={job.job_description}
          scheduledDate={job.scheduled_date}
          createdAt={job.created_at}
          updatedAt={job.updated_at}
        />
        {isCompleted && (
          <JobDetailCompletionSection
            completedAt={job.completed_at}
            industryData={industryData}
            completionNotes={completionNotes}
            jobPhotos={attachmentPhotos}
          />
        )}
        {showJobReportCard && (
          <JobDetailJobReportCard industryData={industryData} />
        )}
        {!isCompleted &&
          completionNotes !== undefined &&
          completionNotes !== '' && (
            <JobDetailCompletionNotes completionNotes={completionNotes} />
          )}
        {!isCompleted && hasPhotoGroups && (
          <JobDetailPhotosCard
            beforePhotos={attachmentPhotos.before}
            afterPhotos={attachmentPhotos.after}
          />
        )}
        {mapData != null && (
          <Card>
            <CardHeader>
              <CardTitle>Location</CardTitle>
              <CardDescription>
                {job.worker != null && mapData.distance != null
                  ? `${job.worker.full_name} is ${mapData.distance.toFixed(1)}km away`
                  : 'Job location on map'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <JobLocationMap
                jobLocation={mapData.jobLocation}
                workerLocation={mapData.workerLocation}
                distance={mapData.distance}
              />
            </CardContent>
          </Card>
        )}
        <JobDetailSkillsCard
          requiredSkills={job.required_skills ?? []}
          workerSkills={job.worker?.skills}
          hasWorker={!!job.assigned_worker_id}
        />
        <JobStatusTimeline
          entries={statusHistory.map((e) => ({
            id: e.id,
            to_status: e.to_status,
            from_status: e.from_status,
            created_at: e.created_at,
            changed_by_user_id: e.changed_by_user_id,
            changed_by_worker_id: e.changed_by_worker_id,
            notes: e.notes,
          }))}
        />
      </div>

      {/* Right column */}
      <div className="space-y-6">
        {job.customer && (
          <JobDetailCustomerCard
            name={job.customer.name}
            type={job.customer.type}
            email={job.customer.email}
            phone={job.customer.phone}
          />
        )}
        <div id="assignment">
          <JobDetailWorkerCard
            jobId={job.id}
            status={job.status}
            worker={job.worker}
            workers={workers}
          />
        </div>
        <JobDetailActionsCard
          jobId={job.id}
          status={job.status}
          hasWorker={!!job.worker}
        />
      </div>
    </div>
  );
}
