import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConnectStatus } from '@/lib/payments/connect-status';
import {
  getPaymentSettings,
  hasBankDetails,
} from '@/lib/data/payments/settings';

export type GetPaidChecklist = {
  bankDetails: boolean;
  logo: boolean;
  cardPayments: ConnectStatus;
  allDone: boolean;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export async function getGetPaidChecklist(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<GetPaidChecklist> {
  const [settings, { data: tenant }] = await Promise.all([
    getPaymentSettings(supabase, tenantId),
    supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .maybeSingle(),
  ]);

  let logoUrl: string | null = null;
  const settingsJson = (tenant as { settings?: unknown } | null)?.settings;
  if (settingsJson && typeof settingsJson === 'object' && !Array.isArray(settingsJson)) {
    const company = (settingsJson as { company?: unknown }).company;
    if (company && typeof company === 'object' && !Array.isArray(company)) {
      logoUrl = asString((company as { logo_url?: unknown }).logo_url);
    }
  }

  const bankDetails = hasBankDetails(settings);
  const logo = Boolean(logoUrl);
  const cardPayments = settings.connect.status;
  return {
    bankDetails,
    logo,
    cardPayments,
    allDone: bankDetails && logo && cardPayments === 'active',
  };
}
