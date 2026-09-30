import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { choiceToFlag } from '@/lib/messaging/customer-flag';
import { updateCustomerMessagingCore } from '@/lib/messaging/settings-core';
import { setCustomerHouseCore } from '@/lib/rounds/customer-house';
import type { customerFieldSchema } from '@/lib/validations/rounds/customer-field';
import { formatUkPhoneDisplay, normalizeUkPhoneE164 } from '@/lib/utils/phone';

type Change = z.output<typeof customerFieldSchema>;

function blankToNull(value: string): string | null {
  return value === '' ? null : value;
}

async function requireCustomer(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const { data, error } = await supabase
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: 'Customer not found' };
  return { success: true };
}

async function writeColumns(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
  columns: Record<string, unknown>,
): Promise<{ success: true } | { success: false; error: string }> {
  const { error } = await supabase
    .from('customers')
    .update({ ...columns, updated_at: new Date().toISOString() })
    .eq('id', customerId)
    .eq('tenant_id', tenantId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function updateCustomerFieldCore(
  supabase: SupabaseClient,
  p: { tenantId: string; customerId: string; change: Change },
): Promise<{ success: true; value: unknown } | { success: false; error: string }> {
  const found = await requireCustomer(supabase, p.tenantId, p.customerId);
  if (!found.success) return found;

  const { change } = p;

  if (change.field === 'name') {
    const saved = await writeColumns(supabase, p.tenantId, p.customerId, { name: change.value });
    if (!saved.success) return saved;
    return { success: true, value: change.value };
  }

  if (change.field === 'phone') {
    const phone = blankToNull(change.value);
    const phoneE164 = normalizeUkPhoneE164(change.value);
    const saved = await writeColumns(supabase, p.tenantId, p.customerId, {
      phone,
      phone_e164: phoneE164,
    });
    if (!saved.success) return saved;
    const display = formatUkPhoneDisplay(phoneE164);
    return { success: true, value: display || phone || '' };
  }

  if (change.field === 'email') {
    const email = blankToNull(change.value);
    if (email) {
      const { data, error } = await supabase
        .from('customers')
        .select('id')
        .eq('tenant_id', p.tenantId)
        .eq('email', email)
        .neq('id', p.customerId)
        .limit(1)
        .maybeSingle();
      if (error) return { success: false, error: error.message };
      if (data) return { success: false, error: 'Another customer already uses this email' };
    }
    const saved = await writeColumns(supabase, p.tenantId, p.customerId, { email });
    if (!saved.success) return saved;
    return { success: true, value: email };
  }

  if (change.field === 'contact_choice') {
    const saved = await updateCustomerMessagingCore(supabase, p.tenantId, {
      customerId: p.customerId,
      contactChoice: change.value,
    });
    if (!saved.success) return saved;
    return { success: true, value: change.value };
  }

  if (
    change.field === 'visit_reminders' ||
    change.field === 'payment_chasers' ||
    change.field === 'payment_thanks'
  ) {
    const saved = await updateCustomerMessagingCore(supabase, p.tenantId, {
      customerId: p.customerId,
      ...(change.field === 'visit_reminders'
        ? { visitReminders: choiceToFlag(change.value) }
        : change.field === 'payment_chasers'
          ? { paymentChasers: choiceToFlag(change.value) }
          : { paymentThanks: choiceToFlag(change.value) }),
    });
    if (!saved.success) return saved;
    return { success: true, value: change.value };
  }

  if (change.field === 'payment_terms') {
    const saved = await writeColumns(supabase, p.tenantId, p.customerId, {
      payment_terms: change.value,
    });
    if (!saved.success) return saved;
    return { success: true, value: change.value };
  }

  if (change.field === 'house') {
    const saved = await setCustomerHouseCore(supabase, {
      tenantId: p.tenantId,
      customerId: p.customerId,
      address: change.value.address,
      postcode: change.value.postcode,
    });
    if (!saved.success) return saved;
    return { success: true, value: change.value };
  }

  const column = change.field === 'access_notes' ? 'access_notes' : 'notes';
  const stored = blankToNull(change.value);
  const saved = await writeColumns(supabase, p.tenantId, p.customerId, { [column]: stored });
  if (!saved.success) return saved;
  return { success: true, value: stored };
}
