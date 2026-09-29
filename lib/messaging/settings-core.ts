import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { contactChoiceToColumn } from '@/lib/messaging/channel';
import {
  parseMessagingSettings,
  withMessagingSettings,
} from '@/lib/messaging/settings';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';
import type {
  customerMessagingSchema,
  messagingSettingsSchema,
} from '@/lib/validations/messaging';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contactPhoneForSave(
  raw: string | null,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null || raw.trim() === '') return { ok: true, value: null };
  const normalised = normalizeUkPhoneE164(raw);
  if (normalised == null) return { ok: false, error: 'Enter a UK phone number' };
  return { ok: true, value: normalised };
}

/** Business-wide message settings. Callers pass the user's client; tenant comes from the session or bearer token. */
export async function saveMessagingSettingsCore(
  supabase: SupabaseClient,
  tenantId: string,
  input: z.output<typeof messagingSettingsSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const phone = contactPhoneForSave(input.contact_phone);
  if (!phone.ok) return { success: false, error: phone.error };

  const { data: tenant, error: loadError } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();
  if (loadError) {
    console.error('[saveMessagingSettingsCore] load', loadError);
    return { success: false, error: loadError.message };
  }

  const current = isPlainObject(tenant?.settings) ? tenant.settings : {};
  // A switch the caller didn't send (an older phone) keeps its saved value.
  const saved = isPlainObject(current.messaging) ? current.messaging : {};
  const sent = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  const settings = withMessagingSettings(
    current,
    parseMessagingSettings({ ...saved, ...sent, contact_phone: phone.value }),
  );

  const { error } = await supabase
    .from('tenants')
    .update({ settings })
    .eq('id', tenantId);
  if (error) {
    console.error('[saveMessagingSettingsCore]', error);
    return { success: false, error: error.message };
  }
  return { success: true };
}

/** One customer's contact order, visit reminders, payment chasers and thank-yous. */
export async function updateCustomerMessagingCore(
  supabase: SupabaseClient,
  tenantId: string,
  input: z.output<typeof customerMessagingSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const patch: {
    visit_reminders?: boolean;
    payment_chasers?: boolean;
    payment_thanks?: boolean;
    preferred_channel?: 'sms' | 'email' | 'none' | null;
    updated_at?: string;
  } = {};
  if (input.visitReminders !== undefined) patch.visit_reminders = input.visitReminders;
  if (input.paymentChasers !== undefined) patch.payment_chasers = input.paymentChasers;
  if (input.paymentThanks !== undefined) patch.payment_thanks = input.paymentThanks;
  if (input.contactChoice !== undefined) {
    patch.preferred_channel = contactChoiceToColumn(input.contactChoice);
  }
  if (
    patch.visit_reminders === undefined &&
    patch.payment_chasers === undefined &&
    patch.payment_thanks === undefined &&
    patch.preferred_channel === undefined
  ) {
    return { success: true };
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('customers')
    .update(patch)
    .eq('tenant_id', tenantId)
    .eq('id', input.customerId);
  if (error) {
    console.error('[updateCustomerMessagingCore]', error);
    return { success: false, error: error.message };
  }
  return { success: true };
}

/** Turns visit reminders on for every active customer who currently has them off. */
export async function turnOnRemindersForAllCore(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ success: true; updated: number } | { success: false; error: string }> {
  const { data, error, count } = await supabase
    .from('customers')
    .update({ visit_reminders: true }, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .eq('visit_reminders', false)
    .select('id');
  if (error) {
    console.error('[turnOnRemindersForAllCore]', error);
    return { success: false, error: error.message };
  }
  const updated = typeof count === 'number' ? count : (data?.length ?? 0);
  return { success: true, updated };
}
