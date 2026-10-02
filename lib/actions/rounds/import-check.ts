'use server';

import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';

/**
 * Has this exact file been imported before? Used for the yellow "you imported
 * this file on 12 Oct" banner. Never blocks: a failed check just shows nothing.
 */
export async function checkImportFile(
  sha256: string
): Promise<{ importedAt: string | null }> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { importedAt: null };

  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { importedAt: null };
  const products = await getTenantProducts();
  if (!products.hasRounds) return { importedAt: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('import_history')
    .select('started_at')
    .eq('tenant_id', tenantId)
    .eq('kind', 'rounds_customers')
    .eq('file_sha256', sha256)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { importedAt: null };
  return { importedAt: data?.started_at ?? null };
}
