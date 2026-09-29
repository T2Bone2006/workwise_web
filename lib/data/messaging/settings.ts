import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseMessagingSettings,
  type MessagingSettings,
} from '@/lib/messaging/settings';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function companyPhone(settings: Record<string, unknown>): string | null {
  const company = settings.company;
  if (!isPlainObject(company)) return null;
  return asString(company.phone);
}

export async function getMessagingSettings(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<MessagingSettings & { companyPhone: string | null; businessName: string }> {
  const fallback = {
    ...parseMessagingSettings(undefined),
    companyPhone: null,
    businessName: 'Your business',
  };

  const { data, error } = await supabase
    .from('tenants')
    .select('name, settings')
    .eq('id', tenantId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('[getMessagingSettings]', error);
    return fallback;
  }

  const row = data as { name?: unknown; settings?: unknown };
  const settings = isPlainObject(row.settings) ? row.settings : {};
  return {
    ...parseMessagingSettings(settings.messaging, settings.rounds),
    companyPhone: companyPhone(settings),
    businessName: asString(row.name) ?? 'Your business',
  };
}
