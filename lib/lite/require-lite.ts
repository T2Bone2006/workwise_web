import 'server-only';

import { getTenantProducts } from '@/lib/data/tenant-products';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type LiteContext = {
  tenantId: string;
  userId: string;
  widget: {
    id: string;
    business_name: string;
    sign_off_name: string | null;
    trade: string;
    service_area: string;
    business_context: string;
  };
};

type LiteFailure = { ok: false; status: 401 | 403 | 404; error: string };

function asWidget(row: unknown): LiteContext['widget'] | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.business_name !== 'string') return null;
  if (typeof r.trade !== 'string') return null;
  if (typeof r.service_area !== 'string') return null;
  if (typeof r.business_context !== 'string') return null;
  if (r.sign_off_name != null && typeof r.sign_off_name !== 'string') return null;
  return {
    id: r.id,
    business_name: r.business_name,
    sign_off_name: (r.sign_off_name as string | null) ?? null,
    trade: r.trade,
    service_area: r.service_area,
    business_context: r.business_context,
  };
}

/**
 * Signed-in account owner of a Lite business that has a widget.
 * The tenant only ever comes from the session. No website check: the public
 * widget stays off until a website is set, and this guard is how the dashboard
 * preview still works.
 */
export async function requireLite(): Promise<{ ok: true; ctx: LiteContext } | LiteFailure> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false, status: 401, error: 'Not signed in' };

  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('role, tenant_id')
    .eq('id', user.id)
    .maybeSingle();
  const row = userRow as { role?: unknown; tenant_id?: unknown } | null;
  if (userError || row?.role !== 'admin' || typeof row.tenant_id !== 'string' || row.tenant_id === '') {
    return { ok: false, status: 403, error: 'Only the account owner can do this.' };
  }

  const products = await getTenantProducts();
  if (!products.hasLite) {
    return { ok: false, status: 403, error: 'The website assistant is part of Lite.' };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('widget_clients')
      .select('id, business_name, sign_off_name, trade, service_area, business_context')
      .eq('tenant_id', row.tenant_id)
      .maybeSingle();
    const widget = error ? null : asWidget(data);
    if (!widget) return { ok: false, status: 404, error: 'No widget' };
    return { ok: true, ctx: { tenantId: row.tenant_id, userId: user.id, widget } };
  } catch {
    return { ok: false, status: 404, error: 'No widget' };
  }
}
