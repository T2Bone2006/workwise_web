'use client';

import { JobDetailDetailsCard } from '@/components/jobs/job-detail-details-card';
import { JobDetailSkillsCard } from '@/components/jobs/job-detail-skills-card';
import { JobStatusTimeline } from '@/components/jobs/job-status-timeline';
import { JobDetailCustomerCard } from '@/components/jobs/job-detail-customer-card';
import { JobDetailWorkerCard } from '@/components/jobs/job-detail-worker-card';
import { JobDetailActionsCard } from '@/components/jobs/job-detail-actions-card';
import { JobDetailJobReportCard } from '@/components/jobs/job-detail-job-report-card';
import { JobDetailCompletionNotes } from '@/components/jobs/job-detail-completion-notes';
import { JobDetailPhotosCard } from '@/components/jobs/job-detail-photos-card';
import { JobLocationMap } from '@/components/maps/job-location-map';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { JobDetailJob, JobStatusHistoryEntry } from '@/lib/types/job-detail';
import type { JobAttachmentRow } from '@/lib/utils/job-attachments';

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
  /** When set, `industry_data` is non-empty */
  industryData?: unknown;
  completionNotes?: string;
  jobPhotos?: { before: JobAttachmentRow[]; after: JobAttachmentRow[] };
}

export function JobDetailView({
  job,
  statusHistory,
  workers,
  mapData,
  industryData,
  completionNotes,
  jobPhotos,
}: JobDetailViewProps) {
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
        {industryData !== undefined && (
          <JobDetailJobReportCard industryData={industryData} />
        )}
        {completionNotes !== undefined && completionNotes !== '' && (
          <JobDetailCompletionNotes completionNotes={completionNotes} />
        )}
        {jobPhotos != null &&
          (jobPhotos.before.length > 0 || jobPhotos.after.length > 0) && (
            <JobDetailPhotosCard
              beforePhotos={jobPhotos.before}
              afterPhotos={jobPhotos.after}
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
