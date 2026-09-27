import { getPaymentSettings, hasBankDetails } from '@/lib/data/payments/settings';
import {
  firstZodError,
  moneyErrorStatus,
  readJsonBody,
  requireRoundsApi,
  roundsJson,
} from '@/lib/api/rounds-request';
import { savePaymentSettingsCore } from '@/lib/payments/money-core';
import { paymentSettingsSchema } from '@/lib/validations/payments';

export async function GET(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const settings = await getPaymentSettings(auth.ctx.supabase, auth.ctx.tenantId);
  return roundsJson({
    bankAccountName: settings.bankAccountName,
    bankSortCode: settings.bankSortCode,
    bankAccountNumber: settings.bankAccountNumber,
    hasBankDetails: hasBankDetails(settings),
    vatRegistered: settings.vatRegistered,
    vatNumber: settings.vatNumber,
    invoiceDueDays: settings.invoiceDueDays,
    invoicePrefix: settings.invoicePrefix,
    invoiceFooter: settings.invoiceFooter,
    nextInvoiceSeq: settings.nextInvoiceSeq,
    connectStatus: settings.connect.status,
  });
}

export async function POST(request: Request) {
  const auth = await requireRoundsApi(request);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const patch = paymentSettingsSchema.partial().safeParse(json.body);
  if (!patch.success) {
    return roundsJson({ error: firstZodError(patch.error) }, 400);
  }

  const current = await getPaymentSettings(auth.ctx.supabase, auth.ctx.tenantId);
  const merged = paymentSettingsSchema.safeParse({
    bankAccountName: patch.data.bankAccountName ?? current.bankAccountName ?? '',
    bankSortCode: patch.data.bankSortCode ?? current.bankSortCode ?? '',
    bankAccountNumber: patch.data.bankAccountNumber ?? current.bankAccountNumber ?? '',
    vatRegistered: patch.data.vatRegistered ?? current.vatRegistered,
    vatNumber: patch.data.vatNumber ?? current.vatNumber ?? '',
    invoiceDueDays: patch.data.invoiceDueDays ?? current.invoiceDueDays,
    invoicePrefix: patch.data.invoicePrefix ?? current.invoicePrefix,
    invoiceFooter: patch.data.invoiceFooter ?? current.invoiceFooter ?? '',
  });
  if (!merged.success) {
    return roundsJson({ error: firstZodError(merged.error) }, 400);
  }

  const saved = await savePaymentSettingsCore(
    auth.ctx.supabase,
    auth.ctx.tenantId,
    merged.data,
  );
  if (!saved.success) {
    return roundsJson({ error: saved.error }, moneyErrorStatus(saved.error));
  }

  return roundsJson({ success: true });
}
