import { requireStaffApi, staffJson } from '@/lib/api/staff-request';
import { isValidYmd, todayInLondon } from '@/lib/rounds/dates';
import { getStaffDay } from '@/lib/team/staff-day';

/** A member of staff's day: only their own stops, with the customer's phone number, price and what they owe. */
export async function GET(request: Request) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const raw = new URL(request.url).searchParams.get('date');
  if (raw !== null && !isValidYmd(raw)) return staffJson({ error: 'Pick a valid date.' }, 400);
  try {
    return staffJson(await getStaffDay(ctx.db, ctx, raw ?? todayInLondon()));
  } catch {
    return staffJson({ error: 'Could not load the day.' }, 503);
  }
}
