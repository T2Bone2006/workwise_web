import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getWorkersForTenant } from '@/lib/data/workers';
import { postcodeToLatLng } from '@/lib/utils/postcode';
import { haversineDistance } from '@/lib/utils/haversine';
import type { JobDetailJob, JobStatusHistoryEntry } from '@/lib/types/job-detail';
import { JobDetailHeader } from '@/components/jobs/job-detail-header';
import { JobDetailView } from '@/components/jobs/job-detail-view';
import { isIndustryDataEmpty } from '@/lib/utils/job-industry-data';
import {
  splitJobAttachmentsForPhotos,
  type JobAttachmentRow,
} from '@/lib/utils/job-attachments';

interface JobDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { id: jobId } = await params;
  const tenantId = await getTenantIdForCurrentUser();

  if (!tenantId) {
    redirect('/jobs?error=no_tenant');
  }

  const supabase = await createClient();

  const { data: jobRow, error: jobError } = await supabase
    .from('jobs')
    .select(
      `
      id,
      tenant_id,
      reference_number,
      address,
      postcode,
      job_description,
      status,
      priority,
      scheduled_date,
      created_at,
      updated_at,
      started_at,
      completed_at,
      customer_id,
      assigned_worker_id,
      required_skills,
      industry_data,
      completion_notes,
      customer:customers!customer_id(id, name, type, email, phone),
      worker:workers!assigned_worker_id(id, full_name, phone, skills, home_postcode, home_lat, home_lng)
    `
    )
    .eq('id', jobId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (jobError) {
    console.error('[JobDetailPage] job query error:', jobError);
    redirect('/jobs?error=load_failed');
  }

  if (!jobRow) {
    redirect('/jobs?error=not_found');
  }

  const { data: statusHistoryRows, error: statusHistoryError } = await supabase
    .from('job_status_history')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });

  if (statusHistoryError) {
    console.error('[JobDetailPage] job_status_history query error:', statusHistoryError);
    console.error('[JobDetailPage] code:', statusHistoryError.code, 'details:', statusHistoryError.details);
  } else {
    console.log('[JobDetailPage] job_status_history rows:', statusHistoryRows?.length ?? 0);
  }

  type CustomerRow = {
    id: string;
    name: string;
    type: string;
    email: string | null;
    phone: string | null;
  };
  type WorkerRow = {
    id: string;
    full_name: string;
    phone: string | null;
    skills?: string[] | null;
    home_postcode?: string | null;
    home_lat?: number | null;
    home_lng?: number | null;
  };
  const rawCustomer = jobRow.customer as CustomerRow | CustomerRow[] | null;
  const rawWorker = jobRow.worker as WorkerRow | WorkerRow[] | null;
  const customer = Array.isArray(rawCustomer) ? rawCustomer[0] ?? null : rawCustomer;
  const worker = Array.isArray(rawWorker) ? rawWorker[0] ?? null : rawWorker;

  // Job coordinates from postcode (jobs table has no lat/lng columns)
  let jobLat: number | null = null;
  let jobLng: number | null = null;
  const jobPostcode = jobRow.postcode ?? '';
  if (jobPostcode) {
    const coords = await postcodeToLatLng(jobPostcode);
    if (coords) {
      jobLat = coords.lat;
      jobLng = coords.lng;
    }
  }

  let distance: number | undefined;
  if (
    worker?.home_lat != null &&
    worker?.home_lng != null &&
    jobLat != null &&
    jobLng != null
  ) {
    distance = haversineDistance(
      jobLat,
      jobLng,
      worker.home_lat,
      worker.home_lng
    );
  }

  const mapData =
    jobLat != null && jobLng != null
      ? {
          jobLocation: {
            address: jobRow.address ?? '',
            postcode: jobPostcode,
            lat: jobLat,
            lng: jobLng,
          },
          workerLocation:
            worker?.home_lat != null && worker?.home_lng != null
              ? {
                  name: worker.full_name ?? '',
                  postcode: worker.home_postcode ?? '',
                  lat: worker.home_lat,
                  lng: worker.home_lng,
                }
              : undefined,
          distance,
        }
      : null;

  const job: JobDetailJob = {
    id: jobRow.id,
    tenant_id: jobRow.tenant_id,
    reference_number: jobRow.reference_number ?? '',
    address: jobRow.address ?? '',
    postcode: jobRow.postcode ?? '',
    job_description: jobRow.job_description ?? '',
    status: (jobRow.status as JobDetailJob['status']) ?? 'pending',
    priority: (jobRow.priority as JobDetailJob['priority']) ?? 'normal',
    scheduled_date: jobRow.scheduled_date ?? null,
    created_at: jobRow.created_at,
    updated_at: jobRow.updated_at ?? null,
    started_at: jobRow.started_at ?? null,
    completed_at: jobRow.completed_at ?? null,
    customer_id: jobRow.customer_id ?? null,
    assigned_worker_id: jobRow.assigned_worker_id ?? null,
    customer: customer
      ? {
          id: customer.id,
          name: customer.name ?? '',
          type: customer.type ?? 'individual',
          email: customer.email ?? null,
          phone: customer.phone ?? null,
        }
      : null,
    worker: worker
      ? {
          id: worker.id,
          full_name: worker.full_name ?? '',
          phone: worker.phone ?? null,
          skills: Array.isArray(worker.skills) ? worker.skills : undefined,
        }
      : null,
    required_skills: Array.isArray(jobRow.required_skills) ? (jobRow.required_skills as string[]) : [],
  };

  const statusHistory: JobStatusHistoryEntry[] = (statusHistoryRows ?? []).map(
    (row: Record<string, unknown>) => ({
      id: row.id as string,
      job_id: row.job_id as string,
      from_status: (row.from_status as string) ?? null,
      to_status: (row.to_status as string) ?? '',
      changed_by_user_id: (row.changed_by_user_id as string) ?? null,
      changed_by_worker_id: (row.changed_by_worker_id as string) ?? null,
      notes: (row.notes as string) ?? null,
      created_at: row.created_at as string,
    })
  );

  const { data: attachmentRows, error: attachmentsError } = await supabase
    .from('job_attachments')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });

  console.log('[JobDetailPage] job_attachments raw result:', {
    error: attachmentsError,
    data: attachmentRows,
  });

  if (attachmentsError) {
    console.error('[JobDetailPage] job_attachments query error:', attachmentsError);
  }

  const jobPhotosSplit = splitJobAttachmentsForPhotos(
    (attachmentRows ?? []) as JobAttachmentRow[]
  );

  const industryRaw = jobRow.industry_data;
  const showJobReport = !isIndustryDataEmpty(industryRaw);
  const industryDataForDetail =
    job.status === 'completed'
      ? industryRaw
      : showJobReport
        ? industryRaw
        : undefined;

  const completionNotesTrimmed = (jobRow.completion_notes ?? '').trim();

  const { workers } = await getWorkersForTenant(tenantId);
  const workerOptions = workers.map((w) => ({ id: w.id, full_name: w.full_name }));

  return (
    <div className="space-y-6">
      <JobDetailHeader
        jobId={job.id}
        referenceNumber={job.reference_number}
        status={job.status}
        priority={job.priority}
        createdAt={job.created_at}
      />
      <JobDetailView
        job={job}
        statusHistory={statusHistory}
        workers={workerOptions}
        mapData={mapData}
        industryData={industryDataForDetail}
        completionNotes={
          job.status === 'completed'
            ? completionNotesTrimmed
            : completionNotesTrimmed.length > 0
              ? completionNotesTrimmed
              : undefined
        }
        attachmentPhotos={jobPhotosSplit}
      />
    </div>
  );
}
