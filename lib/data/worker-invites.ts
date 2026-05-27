import { createClient } from '@/lib/supabase/server';
import type { WorkerType } from '@/lib/types/worker';

export interface WorkerInviteRow {
  inviteId: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  isExpired: boolean;
  worker: {
    id: string;
    full_name: string;
    phone: string | null;
    worker_type: WorkerType | null;
  };
}

export interface DeactivatedWorkerRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  worker_type: WorkerType | null;
}

export async function getWorkerInvitesForTenant(
  tenantId: string
): Promise<{ invites: WorkerInviteRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('worker_invites')
      .select(
        `
        id,
        email,
        created_at,
        expires_at,
        workers!inner (
          id,
          full_name,
          phone,
          worker_type
        )
      `
      )
      .eq('tenant_id', tenantId)
      .is('used_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[getWorkerInvitesForTenant]', error);
      return { invites: [], error: new Error(error.message ?? 'Failed to load invites') };
    }

    const now = Date.now();
    const invites: WorkerInviteRow[] = (Array.isArray(data) ? data : []).map((row) => {
      const workersRaw = row.workers as
        | {
            id: string;
            full_name: string;
            phone?: string | null;
            worker_type?: WorkerType | null;
          }
        | Array<{
            id: string;
            full_name: string;
            phone?: string | null;
            worker_type?: WorkerType | null;
          }>;
      const worker = Array.isArray(workersRaw) ? workersRaw[0] : workersRaw;
      const expiresAt = String(row.expires_at ?? '');
      return {
        inviteId: String(row.id),
        email: String(row.email ?? ''),
        createdAt: String(row.created_at ?? ''),
        expiresAt,
        isExpired: expiresAt ? new Date(expiresAt).getTime() < now : false,
        worker: {
          id: worker?.id ?? '',
          full_name: worker?.full_name ?? '',
          phone: worker?.phone ?? null,
          worker_type: worker?.worker_type ?? null,
        },
      };
    });

    return { invites, error: null };
  } catch (err) {
    console.error('[getWorkerInvitesForTenant]', err);
    return {
      invites: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export async function getDeactivatedWorkersForTenant(
  tenantId: string
): Promise<{ workers: DeactivatedWorkerRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('workers')
      .select('id, full_name, email, phone, worker_type')
      .eq('primary_tenant_id', tenantId)
      .eq('invite_status', 'deactivated')
      .order('full_name');

    if (error) {
      console.error('[getDeactivatedWorkersForTenant]', error);
      return { workers: [], error: new Error(error.message ?? 'Failed to load inactive workers') };
    }

    const workers: DeactivatedWorkerRow[] = (Array.isArray(data) ? data : []).map((row) => ({
      id: String(row.id),
      full_name: String(row.full_name ?? ''),
      email: row.email != null ? String(row.email) : null,
      phone: row.phone != null ? String(row.phone) : null,
      worker_type: (row.worker_type as WorkerType) ?? null,
    }));

    return { workers, error: null };
  } catch (err) {
    console.error('[getDeactivatedWorkersForTenant]', err);
    return {
      workers: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
