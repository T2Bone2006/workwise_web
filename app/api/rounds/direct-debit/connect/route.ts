import { z } from 'zod';
import { requireDirectDebitApi, unexpected } from '@/lib/api/direct-debit-request';
import { firstZodError, readJsonBody, roundsJson } from '@/lib/api/rounds-request';
import { isGoCardlessConfigured } from '@/lib/gocardless/config';
import { goCardlessPrefillFor } from '@/lib/gocardless/connect-prefill';
import { startGoCardlessConnect } from '@/lib/gocardless/oauth';

export const runtime = 'nodejs';

const bodySchema = z.object({ hasAccount: z.boolean({ message: 'hasAccount must be true or false.' }) });

/** The phone asks for GoCardless's page and opens it in the browser (T20). */
export async function POST(request: Request) {
  const auth = await requireDirectDebitApi(request, 'act');
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = bodySchema.safeParse(json.body);
  if (!parsed.success) return roundsJson({ error: firstZodError(parsed.error) }, 400);

  if (!isGoCardlessConfigured()) {
    return roundsJson({ error: "Direct Debit isn't set up on this server yet." }, 400);
  }

  const { admin, supabase, tenantId, userId } = auth.ctx;
  try {
    const prefill = await goCardlessPrefillFor(supabase, { userId, tenantId });
    const url = await startGoCardlessConnect(admin, {
      tenantId,
      from: 'app',
      hasAccount: parsed.data.hasAccount,
      prefill,
    });
    return roundsJson({ url });
  } catch (err) {
    return unexpected('POST /api/rounds/direct-debit/connect', err);
  }
}
