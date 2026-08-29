/**
 * Settings types and defaults. Safe to import from client components.
 * Server-only data fetching is in settings.ts.
 */

export type IndustryOption =
  | 'Locksmith'
  | 'Plumbing'
  | 'Electrical'
  | 'HVAC'
  | 'General';

export interface TenantSettingsCompany {
  industry?: IndustryOption;
  phone?: string;
  email?: string;
  address?: string;
  logo_url?: string;
}

export interface PricingMargins {
  standard_jobs_markup_percent?: number;
  emergency_jobs_markup_percent?: number;
  callout_fee_markup_percent?: number;
  materials_markup_percent?: number;
}

export interface XeroIntegration {
  connected: boolean;
  organisation_name?: string;
  last_sync?: string;
}

export interface VAPIIntegration {
  configured: boolean;
  phone_number?: string;
  api_key_masked?: string;
}

export interface AnthropicIntegration {
  configured: boolean;
  api_key_masked?: string;
  usage_this_month_usd?: number;
}

export interface IntegrationsSettings {
  xero?: XeroIntegration;
  vapi?: VAPIIntegration;
  anthropic?: AnthropicIntegration;
}

export interface NotificationsSettings {
  email?: {
    new_job_created?: boolean;
    job_assigned_to_worker?: boolean;
    job_completed?: boolean;
    payment_received?: boolean;
    weekly_summary_report?: boolean;
    monthly_revenue_report?: boolean;
  };
  push?: {
    job_status_changes?: boolean;
    new_messages?: boolean;
    worker_availability_changes?: boolean;
  };
  worker?: {
    push_when_job_assigned?: boolean;
    sms_for_emergency_jobs?: boolean;
    daily_summary_assigned_jobs?: boolean;
  };
}

/**
 * Standard fields the jobs list table can show as columns. Deliberately
 * separate from source_fields (spreadsheet columns) — see [[field-filter]]
 * for why those aren't part of this picker.
 */
export type JobsListColumnKey =
  | 'customer'
  | 'address'
  | 'postcode'
  | 'worker'
  | 'scheduled'
  | 'priority'
  | 'status'
  | 'skills'
  | 'created_at';

export const JOBS_LIST_COLUMNS: Array<{ key: JobsListColumnKey; label: string }> = [
  { key: 'customer', label: 'Customer' },
  { key: 'address', label: 'Address' },
  { key: 'postcode', label: 'Postcode' },
  { key: 'worker', label: 'Worker' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'skills', label: 'Skills' },
  { key: 'created_at', label: 'Created' },
];

const JOBS_LIST_COLUMN_KEYS = new Set(JOBS_LIST_COLUMNS.map((c) => c.key));

export function isJobsListColumnKey(value: string): value is JobsListColumnKey {
  return JOBS_LIST_COLUMN_KEYS.has(value as JobsListColumnKey);
}

const DEFAULT_JOBS_LIST_COLUMNS: JobsListColumnKey[] = [
  'customer',
  'address',
  'worker',
  'scheduled',
  'status',
];

export function getDefaultJobsListColumns(): JobsListColumnKey[] {
  return [...DEFAULT_JOBS_LIST_COLUMNS];
}

export interface TenantSettings {
  company?: TenantSettingsCompany;
  pricing_margins?: PricingMargins;
  integrations?: IntegrationsSettings;
  notifications?: NotificationsSettings;
  user_phone?: Record<string, string>;
  jobs_list?: {
    columns?: JobsListColumnKey[];
  };
  features?: {
    pro?: boolean;
    widget?: boolean;
    autopilot?: boolean;
    voice?: boolean;
    payments?: boolean;
  };
}

export interface TenantForSettings {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  settings: TenantSettings;
  subscription_status: string | null;
  subscription_tier: string | null;
  created_at: string;
}

export interface UserForSettings {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  avatar_url: string | null;
  tenant_id: string | null;
  created_at: string;
}

export interface SettingsPageData {
  tenant: TenantForSettings | null;
  user: UserForSettings | null;
  tenantId: string | null;
  totalJobsCount: number;
  totalWorkersCount: number;
}

const DEFAULT_PRICING: PricingMargins = {
  standard_jobs_markup_percent: 44,
  emergency_jobs_markup_percent: 60,
  callout_fee_markup_percent: 50,
  materials_markup_percent: 30,
};

const DEFAULT_NOTIFICATIONS: NotificationsSettings = {
  email: {
    new_job_created: true,
    job_assigned_to_worker: true,
    job_completed: true,
    payment_received: true,
    weekly_summary_report: false,
    monthly_revenue_report: false,
  },
  push: {
    job_status_changes: true,
    new_messages: true,
    worker_availability_changes: false,
  },
  worker: {
    push_when_job_assigned: true,
    sms_for_emergency_jobs: false,
    daily_summary_assigned_jobs: true,
  },
};

export function getDefaultPricingMargins(): PricingMargins {
  return { ...DEFAULT_PRICING };
}

export function getDefaultNotifications(): NotificationsSettings {
  return JSON.parse(JSON.stringify(DEFAULT_NOTIFICATIONS));
}
