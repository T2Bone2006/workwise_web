'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { isTenantAdmin } from '@/lib/stripe/connect';
import { refreshMandateLinks } from '@/lib/direct-debit/existing';
import { getDirectDebitState } from '@/lib/direct-debit/state';

const NOT_FOUND = 'That import could not be found.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AfterImportDirectDebit = { linked: number; toCheck: number; notMatched: number };

export type AfterImportResult =
  | {
      success: true;
      directDebit: AfterImportDirectDebit | null;
      /** True when GoCardless is on but the check threw. The done screen still shows. */
      directDebitCheckFailed: boolean;
    }
  | { success: false; error: string };

/**
 * After a Rounds import: if Direct Debit is on, match existing GoCardless
 * mandates to the customers that now exist. Safe to call again.
 * Does not collect a payment or change a mandate beyond that match.
 */
export async function afterImport(input: { importId: string }): Promise<AfterImportResult> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not signed in' };

  const products = await getTenantProducts();
  if (!products.hasRounds) return { success: false, error: 'Import is part of Rounds.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not signed in' };
  if (!(await isTenantAdmin(supabase, user.id))) {
    return { success: false, error: 'Only the account owner can import customers.' };
  }

  if (!UUID_RE.test(input.importId)) return { success: false, error: NOT_FOUND };

  const { data, error } = await supabase
    .from('import_history')
    .select('id, tenant_id, kind')
    .eq('id', input.importId)
    .maybeSingle();

  const row = data as { tenant_id?: string; kind?: string | null } | null;
  if (error || !row || row.tenant_id !== tenantId || row.kind !== 'rounds_customers') {
    return { success: false, error: NOT_FOUND };
  }

  const admin = createAdminClient();
  const state = await getDirectDebitState(admin, tenantId);
  if (state !== 'on') {
    return { success: true, directDebit: null, directDebitCheckFailed: false };
  }

  try {
    const summary = await refreshMandateLinks(admin, tenantId);
    return {
      success: true,
      directDebit: {
        linked: summary.autoLinked,
        toCheck: summary.probable,
        notMatched: summary.unmatched,
      },
      directDebitCheckFailed: false,
    };
  } catch (err) {
    console.error('[afterImport] direct debit', err instanceof Error ? err.message : 'error');
    return { success: true, directDebit: null, directDebitCheckFailed: true };
  }
}
