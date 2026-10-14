import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { createAdminClient } from '@/lib/supabase/admin';
import { lastHelperIds } from '@/lib/team/crew-day';

/** For the owner's Start day sheet: active helpers and leads, and who they went out with last time. */
export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const db = createAdminClient();
  const { data, error } = await db
    .from('team_people')
    .select('id, name, kind')
    .eq('tenant_id', auth.ctx.tenantId)
    .in('kind', ['helper', 'lead'])
    .is('ended_at', null);
  if (error) return roundsJson({ error: 'Could not load your helpers.' }, 503);
  const helpers = ((data ?? []) as Array<{ id: string; name: string; kind: string }>)
    .map((row) => ({ id: row.id, name: row.name, kind: row.kind === 'lead' ? 'lead' as const : 'helper' as const }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return roundsJson({ helpers, helperIds: await lastHelperIds(db, auth.ctx.tenantId, null) });
}
