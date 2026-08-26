import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/admin';
import { restoreViewAsTenantIfNeeded } from '@/lib/impersonation/session';

/** Restore the admin user's real tenant_id and clear view-as cookies. */
export async function POST() {
  try {
    await requireAdmin();
    await restoreViewAsTenantIfNeeded();
    return NextResponse.json({ success: true, redirectTo: '/admin/view-as' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    const status = message.includes('Unauthorized') || message.includes('Admin') ? 403 : 500;
    console.error('[view-as/stop]', err);
    return NextResponse.json({ error: message }, { status });
  }
}
