import type { SupabaseClient } from '@supabase/supabase-js';
import { parseRoundsSettings, type RoundsSettings } from '@/lib/rounds/settings';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function getRoundsSettings(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<RoundsSettings> {
  const { data, error } = await supabase
    .from('tenants')
    .select('settings')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) {
    console.error('[getRoundsSettings]', error);
    return parseRoundsSettings(undefined);
  }

  const settings = isPlainObject(data?.settings) ? data.settings : {};
  return parseRoundsSettings(settings.rounds);
}
