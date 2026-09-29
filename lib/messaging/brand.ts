import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseMessagingSettings,
  type MessagingSettings,
} from '@/lib/messaging/settings';
import { normalizeUkPhoneE164 } from '@/lib/utils/phone';

export type TenantMessagingContext = {
  tenantId: string;
  businessName: string; // tenants.name
  contactPhone: string | null; // settings.messaging.contact_phone ?? normalizeUkPhoneE164(settings.company.phone)
  replyToEmail: string | null; // settings.company.email, else null
  logoUrl: string | null; // settings.company.logo_url
  settings: MessagingSettings; // parseMessagingSettings(settings.messaging, settings.rounds)
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function companyBits(settings: unknown): {
  email: string | null;
  logoUrl: string | null;
  phone: string | null;
} {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { email: null, logoUrl: null, phone: null };
  }
  const company = (settings as { company?: unknown }).company;
  if (!company || typeof company !== 'object' || Array.isArray(company)) {
    return { email: null, logoUrl: null, phone: null };
  }
  const c = company as {
    email?: unknown;
    logo_url?: unknown;
    phone?: unknown;
  };
  return {
    email: asString(c.email),
    logoUrl: asString(c.logo_url),
    phone: asString(c.phone),
  };
}

export async function getTenantMessagingContext(
  admin: SupabaseClient,
  tenantId: string,
): Promise<TenantMessagingContext | null> {
  const { data, error } = await admin
    .from('tenants')
    .select('id, name, settings')
    .eq('id', tenantId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as { id: string; name?: unknown; settings?: unknown };
  const rawSettings =
    row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
      ? (row.settings as Record<string, unknown>)
      : {};
  const messaging = parseMessagingSettings(
    rawSettings.messaging,
    rawSettings.rounds,
  );
  const company = companyBits(rawSettings);

  return {
    tenantId: row.id,
    businessName: asString(row.name) ?? 'Your business',
    contactPhone: messaging.contact_phone ?? normalizeUkPhoneE164(company.phone),
    replyToEmail: company.email,
    logoUrl: company.logoUrl,
    settings: messaging,
  };
}
