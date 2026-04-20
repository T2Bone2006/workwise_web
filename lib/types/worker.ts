export type WorkerStatus = 'available' | 'busy' | 'unavailable' | 'off_duty';
export type WorkerType = 'company_subcontractor' | 'platform_solo' | 'both';
export type WorkerInviteStatus = 'pending' | 'active';

export interface WorkerRow {
  id: string;
  primary_tenant_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  invite_status: WorkerInviteStatus;
  home_postcode: string | null;
  home_lat: number | null;
  home_lng: number | null;
  worker_type: WorkerType | null;
  status: WorkerStatus | null;
  skills: string[] | null;
  created_at?: string;
  updated_at?: string;
}

export interface WorkersFilters {
  search?: string;
  status?: WorkerStatus | WorkerStatus[];
  worker_type?: WorkerType;
  has_skills?: string | string[];
  sort?: 'full_name' | 'phone' | 'status';
  sort_dir?: 'asc' | 'desc';
}
