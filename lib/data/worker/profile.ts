import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { getWorkerLink } from '@/lib/auth/worker-link';

export type WorkerProfile = {
  fullName: string;
  email: string;
  phone: string | null;
  homePostcode: string | null;
  skills: string[];
  employerName: string;
  workerType: 'employee' | 'company_subcontractor' | 'both';
  hasOwnBusiness: boolean;
  jobsDone: number;
  jobsDeclined: number;
};

type WorkerRow = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  home_postcode: string | null;
  skills: unknown;
};

function skillKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === 'string' ? item : (item as { key?: unknown } | null)?.key))
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/** "lock_picking" -> "Lock picking" when the employer's skill list can't be read. */
function prettySkill(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The signed-in worker's own details and totals, or null when they are not linked to an employer. */
export async function getMyProfile(): Promise<WorkerProfile | null> {
  const link = await getWorkerLink();
  if (!link) return null;
  const { user } = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const [workerRes, doneRes, declinedRes, skillsRes] = await Promise.all([
    supabase
      .from('workers')
      .select('full_name, email, phone, home_postcode, skills')
      .eq('id', link.workerId)
      .maybeSingle<WorkerRow>(),
    // Counted from the jobs themselves: workers.total_jobs_completed is a counter nothing updates.
    supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_worker_id', link.workerId)
      .eq('status', 'completed'),
    supabase
      .from('job_status_history')
      .select('job_id')
      .eq('changed_by_worker_id', link.workerId)
      .eq('to_status', 'declined'),
    supabase.from('tenant_skills').select('key, label').eq('tenant_id', link.employerTenantId),
  ]);

  if (workerRes.error || !workerRes.data) {
    console.error('[worker/profile] worker read failed');
    return null;
  }

  const labels = new Map<string, string>();
  for (const row of (skillsRes.data ?? []) as Array<{ key: string; label: string | null }>) {
    if (row.label) labels.set(row.key, row.label);
  }
  const declinedIds = new Set(
    ((declinedRes.data ?? []) as Array<{ job_id: string | null }>).map((r) => r.job_id).filter(Boolean),
  );
  const w = workerRes.data;

  return {
    fullName: w.full_name?.trim() || 'Worker',
    email: w.email?.trim() || user.email || '',
    phone: w.phone?.trim() || null,
    homePostcode: w.home_postcode?.trim() || null,
    skills: skillKeys(w.skills).map((key) => labels.get(key) ?? prettySkill(key)),
    employerName: link.employerName,
    workerType: link.workerType,
    hasOwnBusiness: link.hasOwnBusiness,
    jobsDone: doneRes.error ? 0 : (doneRes.count ?? 0),
    jobsDeclined: declinedIds.size,
  };
}

/** Just the first name, for the greeting. Cheap: one small read. */
export async function getMyFirstName(): Promise<string | null> {
  const link = await getWorkerLink();
  if (!link) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('workers')
    .select('full_name')
    .eq('id', link.workerId)
    .maybeSingle<{ full_name: string | null }>();
  const first = data?.full_name?.trim().split(/\s+/)[0];
  return first ? first : null;
}
