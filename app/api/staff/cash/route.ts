import { requireStaffApi, staffJson } from '@/lib/api/staff-request';
import { getStaffCash } from '@/lib/team/staff-cash';

/** What a member of staff is holding for the owner, and what they handed over recently. Their own payments only. */
export async function GET(request: Request) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;
  try {
    return staffJson(await getStaffCash(auth.ctx.db, auth.ctx));
  } catch {
    return staffJson({ error: 'Could not load your cash.' }, 503);
  }
}
