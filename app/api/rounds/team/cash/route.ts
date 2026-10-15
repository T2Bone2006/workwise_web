import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { createAdminClient } from '@/lib/supabase/admin';
import { listHeldCash, recentHandIns } from '@/lib/team/hand-in';

/** Everything the team is holding for the owner, grouped by person, and the latest hand-ins (owner only). */
export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;
  const db = createAdminClient();
  try {
    const [groups, recent] = await Promise.all([listHeldCash(db, auth.ctx.tenantId), recentHandIns(db, auth.ctx.tenantId)]);
    const totalHeld = Math.round(groups.reduce((sum, g) => sum + g.total, 0) * 100) / 100;
    return roundsJson({ groups, recent, totalHeld });
  } catch {
    return roundsJson({ error: 'Could not load the cash.' }, 503);
  }
}
