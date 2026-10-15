import { z } from 'zod';
import {
  coreError,
  parseUuidParam,
  requireDirectDebitApi,
  unexpected,
} from '@/lib/api/direct-debit-request';
import { firstZodError, readJsonBody, roundsJson } from '@/lib/api/rounds-request';
import { resolveFailedCollection } from '@/lib/direct-debit/after-collection';

export const runtime = 'nodejs';

const bodySchema = z.object({
  action: z.enum(['collect_again', 'leave'], { message: 'Choose Collect again or Leave it.' }),
});

/** Collect again / Leave it on a failed collection. A second device gets 409. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireDirectDebitApi(request, 'act');
  if (!auth.ok) return auth.response;

  const id = parseUuidParam((await context.params).id);
  if (!id.ok) return id.response;
  const json = await readJsonBody(request);
  if (!json.ok) return json.response;
  const parsed = bodySchema.safeParse(json.body);
  if (!parsed.success) return roundsJson({ error: firstZodError(parsed.error) }, 400);

  try {
    const result = await resolveFailedCollection(auth.ctx.admin, {
      tenantId: auth.ctx.tenantId,
      userId: auth.ctx.userId,
      collectionId: id.id,
      action: parsed.data.action,
    });
    if (!result.ok) return coreError(result.error);
    return roundsJson({ ok: true, newCollectionId: result.newCollectionId });
  } catch (err) {
    return unexpected('POST /api/rounds/direct-debit/collections/[id]', err);
  }
}
