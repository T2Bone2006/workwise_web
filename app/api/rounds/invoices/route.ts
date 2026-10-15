import { z } from 'zod';
import {
  firstZodError,
  moneyErrorStatus,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { createInvoiceCore } from '@/lib/invoices/invoice-core';
import { sendInvoiceEmail } from '@/lib/payments/notify';
import { invoiceLinkUrl } from '@/lib/payments/tokens';

const createInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  scope: z.enum(['visit', 'balance']),
  jobId: z.string().uuid().optional(),
  email: z.boolean(),
  to: z.string().trim().email().optional().or(z.literal('')),
});

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = createInvoiceSchema.safeParse(json.body);
  if (!parsed.success) {
    return roundsJson({ error: firstZodError(parsed.error) }, 400);
  }

  const created = await createInvoiceCore(auth.ctx.supabase, {
    tenantId: auth.ctx.tenantId,
    customerId: parsed.data.customerId,
    scope: parsed.data.scope,
    jobId: parsed.data.jobId ?? null,
  });
  if (!created.success) {
    return roundsJson({ error: created.error }, moneyErrorStatus(created.error));
  }

  const { data: invoice, error: tokenError } = await auth.ctx.supabase
    .from('invoices')
    .select('public_token')
    .eq('id', created.invoiceId)
    .eq('tenant_id', auth.ctx.tenantId)
    .maybeSingle();

  const token =
    invoice && typeof (invoice as { public_token?: unknown }).public_token === 'string'
      ? (invoice as { public_token: string }).public_token
      : null;
  if (tokenError || !token) {
    return roundsJson({ error: 'Could not create the invoice' }, 400);
  }

  let url: string;
  try {
    url = invoiceLinkUrl(token);
  } catch (err) {
    console.error('invoice link', err);
    return roundsJson({ error: 'Pay links are not configured.' }, 400);
  }

  let emailed = false;
  const to = parsed.data.to?.trim() || null;
  if (parsed.data.email && !created.existing) {
    const sent = await sendInvoiceEmail(auth.ctx.supabase, {
      tenantId: auth.ctx.tenantId,
      invoiceId: created.invoiceId,
      to,
    });
    emailed = sent.sent;
    if (!sent.sent && sent.error) {
      console.error('[rounds invoices] email', sent.error);
    }
  }

  return roundsJson({
    invoiceId: created.invoiceId,
    number: created.number,
    url,
    emailed,
    existing: created.existing,
  });
}
