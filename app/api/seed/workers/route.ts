import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { generateSeedWorkers, SEED_EMAIL_DOMAIN } from '@/lib/seed/workers';

const MAX_SEED_COUNT = 100;

/**
 * POST /api/seed/workers – Create seed workers for the current tenant.
 * Body: { count?: number } (default 30, max 100)
 * Seed workers use email *@seed.workwise.local so they can be wiped with DELETE.
 */
export async function POST(req: Request) {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return NextResponse.json({ error: 'Not authenticated or no tenant' }, { status: 401 });
    }

    let count = 30;
    try {
      const body = await req.json().catch(() => ({}));
      if (typeof body.count === 'number' && body.count > 0) {
        count = Math.min(Math.floor(body.count), MAX_SEED_COUNT);
      }
    } catch {
      // use default count
    }

    const workers = generateSeedWorkers(tenantId, count);
    const rows = workers.map((w) => ({
      full_name: w.full_name,
      phone: w.phone,
      email: w.email,
      primary_tenant_id: w.primary_tenant_id,
      home_postcode: w.home_postcode,
      home_lat: w.home_lat,
      home_lng: w.home_lng,
      service_radius_km: w.service_radius_km,
      skills: w.skills,
      status: w.status,
    }));

    const supabase = await createClient();
    const { data, error } = await supabase.from('workers').insert(rows).select('id');

    if (error) {
      console.error('[seed/workers] insert error:', error);
      return NextResponse.json(
        { error: error.message ?? 'Failed to create seed workers' },
        { status: 500 }
      );
    }

    const created = data?.length ?? 0;
    return NextResponse.json({
      success: true,
      created,
      message: `Created ${created} seed workers. Wipe them before production with DELETE /api/seed/workers`,
    });
  } catch (err) {
    console.error('[seed/workers] POST', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Seed failed' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/seed/workers – Remove all seed workers (email ending with @seed.workwise.local).
 * Only deletes workers belonging to the current user's tenant.
 */
export async function DELETE() {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return NextResponse.json({ error: 'Not authenticated or no tenant' }, { status: 401 });
    }

    const supabase = await createClient();

    // First get IDs of seed workers for this tenant (workers.primary_tenant_id = tenantId and email like %@seed.workwise.local)
    const { data: seedWorkers, error: fetchError } = await supabase
      .from('workers')
      .select('id')
      .eq('primary_tenant_id', tenantId)
      .like('email', `%${SEED_EMAIL_DOMAIN}`);

    if (fetchError) {
      console.error('[seed/workers] fetch error:', fetchError);
      return NextResponse.json(
        { error: fetchError.message ?? 'Failed to find seed workers' },
        { status: 500 }
      );
    }

    const ids = (seedWorkers ?? []).map((r) => r.id);
    if (ids.length === 0) {
      return NextResponse.json({
        success: true,
        deleted: 0,
        message: 'No seed workers to delete',
      });
    }

    // Unassign any jobs assigned to these workers (set assigned_worker_id to null)
    await supabase
      .from('jobs')
      .update({ assigned_worker_id: null })
      .in('assigned_worker_id', ids);

    const { error: deleteError } = await supabase.from('workers').delete().in('id', ids);

    if (deleteError) {
      console.error('[seed/workers] delete error:', deleteError);
      return NextResponse.json(
        { error: deleteError.message ?? 'Failed to delete seed workers' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      deleted: ids.length,
      message: `Removed ${ids.length} seed workers`,
    });
  } catch (err) {
    console.error('[seed/workers] DELETE', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Wipe failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/seed/workers – Return count of seed workers for current tenant (for UI).
 */
export async function GET() {
  try {
    const tenantId = await getTenantIdForCurrentUser();
    if (!tenantId) {
      return NextResponse.json({ error: 'Not authenticated or no tenant' }, { status: 401 });
    }

    const supabase = await createClient();
    const { count, error } = await supabase
      .from('workers')
      .select('*', { count: 'exact', head: true })
      .eq('primary_tenant_id', tenantId)
      .like('email', `%${SEED_EMAIL_DOMAIN}`);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ seedCount: count ?? 0 });
  } catch (err) {
    console.error('[seed/workers] GET', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 }
    );
  }
}
