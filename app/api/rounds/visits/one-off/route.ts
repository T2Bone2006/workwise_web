import {
  actorForUser,
  firstZodError,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { createOneOffVisitCore, listOneOffCustomerOptions } from '@/lib/rounds/one-off';
import { oneOffVisitSchema } from '@/lib/validations/rounds/visit';

/** Customers for the phone's one-off form, each with the address to fill in. */
export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const { options, error } = await listOneOffCustomerOptions(
    auth.ctx.supabase,
    auth.ctx.tenantId,
  );
  if (error) return roundsJson({ error }, 500);
  return roundsJson({ customers: options });
}

/** Add a one-off visit from the phone. Same rules as the dashboard's One-off button. */
export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = oneOffVisitSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const actor = await actorForUser(auth.ctx.supabase, auth.ctx.userId);
  const result = await createOneOffVisitCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    actor,
    values: parsed.data,
  });
  if (!result.success) {
    const status = result.error === 'Customer not found' ? 404 : 400;
    return roundsJson({ error: result.error }, status);
  }
  return roundsJson({ jobId: result.jobId });
}
