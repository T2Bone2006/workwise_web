import type { JobStatus, JobPriority } from '@/lib/data/jobs';

export interface JobDetailCustomer {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
}

export interface JobDetailWorker {
  id: string;
  full_name: string;
  phone: string | null;
  skills?: string[];
}

export interface JobDetailJob {
  id: string;
  tenant_id: string;
  reference_number: string;
  address: string;
  postcode: string;
  job_description: string;
  status: JobStatus;
  priority: JobPriority;
  scheduled_date: string | null;
  created_at: string;
  updated_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  customer_id: string | null;
  assigned_worker_id: string | null;
  customer: JobDetailCustomer | null;
  worker: JobDetailWorker | null;
  required_skills?: string[];
}

export interface JobStatusHistoryEntry {
  id: string;
  job_id: string;
  from_status: string | null;
  to_status: string;
  changed_by_user_id: string | null;
  changed_by_worker_id: string | null;
  notes: string | null;
  created_at: string;
}
