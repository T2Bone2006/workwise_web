import type { SupabaseClient } from '@supabase/supabase-js';
import { TEXT_PACKS, summariseTexts, type TextPackKey } from '@/lib/messaging/credits';
import { londonMonth } from '@/lib/messaging/london-time';

export type TextUsage = ReturnType<typeof summariseTexts> & {
  month: string;
  packs: { key: TextPackKey; label: string; pricePence: number; texts: number }[];
};

export async function getTextUsage(
  supabase: SupabaseClient,
  tenantId: string,
  now?: Date,
): Promise<TextUsage> {
  const month = londonMonth(now ?? new Date());
  const { data, error } = await supabase
    .from('tenant_text_balance')
    .select('month, month_used, pack_balance')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    ...summariseTexts(data, month),
    month,
    packs: TEXT_PACKS.map((pack) => ({
      key: pack.key,
      label: pack.label,
      pricePence: pack.pricePence,
      texts: pack.texts,
    })),
  };
}
