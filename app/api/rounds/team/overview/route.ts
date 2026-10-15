import { requireRoundsApi, roundsJson } from '@/lib/api/rounds-request';
import { getTeamPageData } from '@/lib/data/team-page';
import { shapeTeamOverview } from '@/lib/rounds/team-overview';

/** The owner's phone: who is on the team, how far along they are today, and who holds cash. Owner only; no pay. */
export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;
  try {
    return roundsJson(shapeTeamOverview(await getTeamPageData(auth.ctx.tenantId)));
  } catch {
    return roundsJson({ error: 'Could not load your team.' }, 503);
  }
}
