import type { SupabaseClient } from '@supabase/supabase-js';
import { setCustomerSendsInvoice } from '@/lib/payments/money-core';
import { sendVisitDoneNotice } from '@/lib/payments/notify';

/**
 * Everything that happens after a visit is Done, apart from the status change
 * itself. Never throws: each part logs and continues. Safe to call twice for
 * the same visit (the phone may replay). Step 16 adds the customer message and
 * invoice here.
 */
export async function afterVisitCompleted(
  supabase: SupabaseClient,
  p: {
    tenantId: string;
    jobId: string;
    customerId: string | null;
    sendInvoice: boolean | null | undefined;
  },
): Promise<void> {
  try {
    if (typeof p.sendInvoice === 'boolean' && p.customerId) {
      await setCustomerSendsInvoice(supabase, {
        tenantId: p.tenantId,
        customerId: p.customerId,
        sendInvoice: p.sendInvoice,
      });
    }
  } catch (err) {
    console.error('[afterVisitCompleted] sendInvoice', p.jobId, err);
  }

  try {
    await sendVisitDoneNotice(supabase, { tenantId: p.tenantId, jobId: p.jobId });
  } catch (err) {
    console.error('[afterVisitCompleted] visit done notice', p.jobId, err);
  }
}
