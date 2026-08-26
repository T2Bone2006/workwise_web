'use server';

import { requireAdmin } from '@/lib/utils/admin';
import { createAdminClient } from '@/lib/supabase/admin';

export type TenantListItem = {
  id: string;
  name: string;
};

export async function listTenantsForViewAs(): Promise<{
  tenants: TenantListItem[];
  error?: string;
}> {
  try {
    await requireAdmin();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('tenants')
      .select('id, name')
      .order('name', { ascending: true });

    if (error) {
      return { tenants: [], error: error.message };
    }

    return {
      tenants: (data ?? []).map((t) => ({
        id: t.id as string,
        name: ((t.name as string | null)?.trim() || 'Unnamed tenant') as string,
      })),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list tenants';
    return { tenants: [], error: message };
  }
}
