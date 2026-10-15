import { requireStaffApi, staffJson } from '@/lib/api/staff-request';

/** Who is signed in on a member of staff's phone: their name and the business they work for. */
export async function GET(request: Request) {
  const auth = await requireStaffApi(request);
  if (!auth.ok) return auth.response;
  const { ctx } = auth;
  const { data } = await ctx.db.from('tenants').select('name').eq('id', ctx.tenantId).maybeSingle();
  return staffJson({
    name: ctx.name,
    businessName: (data as { name?: string | null } | null)?.name ?? 'Your employer',
    personId: ctx.personId,
    workerId: ctx.workerId,
  });
}
