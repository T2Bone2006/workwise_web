import { requireStaffApi, staffJson } from '@/lib/api/staff-request';
import { getStaffRange } from '@/lib/team/staff-day';

/** Counts per day for a member of staff's own visits (their calendar), at most 62 days. */
export async function GET(request: Request) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const result = await getStaffRange(auth.ctx.db, auth.ctx, params.get('from') ?? '', params.get('to') ?? '', params.get('detail') === '1');
  if (!result.ok) return staffJson({ error: result.error }, 400);
  return staffJson({ days: result.days });
}
