export type WorkerStatus = 'available' | 'busy' | 'unavailable' | 'off_duty';

export const WORKER_TYPE_VALUES = [
  'company_subcontractor',
  'platform_solo',
  'both',
  'employee',
] as const;

export type WorkerType = (typeof WORKER_TYPE_VALUES)[number];

export type WorkerInviteStatus = 'pending' | 'active' | 'accepted' | 'deactivated';

export const WORKER_TYPE_OPTIONS: { value: WorkerType; label: string }[] = [
  { value: 'company_subcontractor', label: 'Subcontractor' },
  { value: 'platform_solo', label: 'Platform Solo' },
  { value: 'both', label: 'Both' },
  { value: 'employee', label: 'Employee' },
];

export const WORKER_TYPE_LABELS = Object.fromEntries(
  WORKER_TYPE_OPTIONS.map(({ value, label }) => [value, label])
) as Record<WorkerType, string>;

export const WORKER_TYPE_FORM_OPTIONS: { value: WorkerType; label: string }[] = [
  { value: 'company_subcontractor' as const, label: 'Subcontractor' },
  { value: 'employee' as const, label: 'Employee' },
];

export const workerTypeBadgeClass: Record<WorkerType, string> = {
  company_subcontractor: 'border-blue-400/50 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  platform_solo: 'border-violet-400/50 bg-violet-500/10 text-violet-700 dark:text-violet-400',
  both: 'border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
  employee: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
};

export interface WorkerRow {
  id: string;
  primary_tenant_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  user_id: string | null;
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
