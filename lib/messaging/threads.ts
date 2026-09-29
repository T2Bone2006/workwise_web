import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isUkMobileE164 } from '@/lib/messaging/phone';

/** Upsert the customer's thread (channel 'sms') and return its id. Updates customer_address when a UK mobile is given. */
export async function ensureThread(
  admin: SupabaseClient,
  p: { tenantId: string; customerId: string; phone: string | null },
): Promise<string> {
  const row: Record<string, unknown> = {
    tenant_id: p.tenantId,
    customer_id: p.customerId,
    channel: 'sms',
  };
  if (isUkMobileE164(p.phone)) {
    row.customer_address = p.phone;
  }

  const { data, error } = await admin
    .from('message_threads')
    .upsert(row, { onConflict: 'tenant_id,customer_id,channel' })
    .select('id')
    .single();

  if (error || !data || typeof (data as { id?: unknown }).id !== 'string') {
    throw new Error(error?.message ?? 'Could not ensure message thread');
  }
  return (data as { id: string }).id;
}

export async function bindThreadToStop(
  admin: SupabaseClient,
  p: { threadId: string; jobIds: string[]; at: Date },
): Promise<void> {
  const { error } = await admin
    .from('message_threads')
    .update({
      active_job_ids: p.jobIds,
      active_set_at: p.at.toISOString(),
    })
    .eq('id', p.threadId);
  if (error) {
    console.error('[bindThreadToStop]', p.threadId, error.message);
  }
}

export async function isOptedOut(
  admin: SupabaseClient,
  phone: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('messaging_opt_outs')
    .select('phone_e164')
    .eq('phone_e164', phone)
    .maybeSingle();
  if (error) {
    console.error('[isOptedOut]', error.message);
    // Fail closed: a lookup error must not let a STOP'd number through.
    return true;
  }
  return data != null;
}
