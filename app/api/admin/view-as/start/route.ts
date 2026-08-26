import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  getViewAsState,
  isUuid,
  persistViewAsOrigin,
  restoreViewAsTenantIfNeeded,
  setViewAsCookies,
} from '@/lib/impersonation/session';

/**
 * POST { tenantId: string }
 * Temporarily points the admin user's tenant_id at the target so RLS allows reads.
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();

    const body = (await request.json().catch(() => null)) as { tenantId?: string } | null;
    const tenantId = body?.tenantId?.trim() ?? '';
    if (!isUuid(tenantId)) {
      return NextResponse.json({ error: 'Invalid tenant' }, { status: 400 });
    }

    const existing = await getViewAsState();
    if (existing.active) {
      await restoreViewAsTenantIfNeeded();
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();

    const { data: target, error: targetError } = await admin
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .maybeSingle();
    if (targetError || !target) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const { data: userRow, error: userError } = await admin
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();
    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 });
    }

    const originTenantId = (userRow?.tenant_id as string | null) ?? null;

    const { error: updateError } = await admin
      .from('users')
      .update({ tenant_id: tenantId })
      .eq('id', user.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await persistViewAsOrigin(user.id, originTenantId);
    await setViewAsCookies(tenantId, originTenantId);
    return NextResponse.json({ success: true, redirectTo: '/dashboard' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    const status = message.includes('Unauthorized') || message.includes('Admin') ? 403 : 500;
    console.error('[view-as/start]', err);
    return NextResponse.json({ error: message }, { status });
  }
}
