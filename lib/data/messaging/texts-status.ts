import type { SupabaseClient } from '@supabase/supabase-js';
import { TEXT_PACKS, type TextPackKey } from '@/lib/messaging/credits';
import { londonMonth } from '@/lib/messaging/london-time';
import { GRACE_TEXTS_PER_MONTH } from '@/lib/messaging/waiting';
import { getTextUsage, type TextUsage } from '@/lib/data/messaging/texts';

/** What the banner and the Texts page need, in one read (also served to the phone). */

export type TextsBanner = 'none' | 'low' | 'out' | 'waiting' | 'paused';
export const LOW_TEXTS_AT = 20;
export const PROMPT_MAX_DISMISSALS = 2;

export type TextsStatus = TextUsage & {
  waiting: { count: number; textsNeeded: number; oldestSince: string | null };
  graceLeft: number;
  autoTopUp: {
    enabled: boolean;
    packKey: TextPackKey;
    triggerLeft: number;
    monthlyCapPence: number;
    spentThisMonthPence: number;
    pausedReason: 'card_failed' | 'needs_authentication' | 'no_card' | null;
    promptVisible: boolean;
    promptDismissed: number;
  };
  banner: TextsBanner;
};

/** Pure: which banner (if any) to show. Priority: paused, out, waiting (back in credit), low. */
export function pickBanner(p: {
  totalLeft: number;
  waitingCount: number;
  paused: boolean;
}): TextsBanner {
  if (p.paused) return 'paused';
  if (p.totalLeft === 0) return 'out';
  if (p.waitingCount > 0) return 'waiting';
  if (p.totalLeft <= LOW_TEXTS_AT) return 'low';
  return 'none';
}

export async function getTextsStatus(
  supabase: SupabaseClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<TextsStatus> {
  const month = londonMonth(now);
  const [usage, graceRes, waitingRes, topUpRes, spentRes] = await Promise.all([
    getTextUsage(supabase, tenantId, now),
    supabase.from('tenant_text_balance').select('grace_month, grace_used').eq('tenant_id', tenantId).maybeSingle(),
    supabase
      .from('messages')
      .select('segments, waiting_since')
      .eq('tenant_id', tenantId)
      .eq('status', 'waiting_texts')
      .order('waiting_since', { ascending: true })
      .limit(500),
    supabase
      .from('text_auto_topup')
      .select('enabled, pack_key, trigger_left, monthly_cap_pence, paused_reason, prompt_dismissed_count')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('text_auto_topup_charges')
      .select('amount_pence')
      .eq('tenant_id', tenantId)
      .eq('month', month)
      .in('status', ['pending', 'paid']),
  ]);

  const grace = graceRes.data as { grace_month: string | null; grace_used: number } | null;
  const graceUsed = grace && grace.grace_month === month ? grace.grace_used : 0;

  const waitingRows = (waitingRes.data ?? []) as { segments: number | null; waiting_since: string | null }[];
  const waiting = {
    count: waitingRows.length,
    textsNeeded: waitingRows.reduce((sum, r) => sum + Math.max(r.segments ?? 1, 1), 0),
    oldestSince: waitingRows[0]?.waiting_since ?? null,
  };

  const top = topUpRes.data as {
    enabled: boolean;
    pack_key: TextPackKey;
    trigger_left: number;
    monthly_cap_pence: number;
    paused_reason: 'card_failed' | 'needs_authentication' | 'no_card' | null;
    prompt_dismissed_count: number;
  } | null;
  const spent = ((spentRes.data ?? []) as { amount_pence: number }[]).reduce(
    (sum, r) => sum + Number(r.amount_pence),
    0,
  );
  const enabled = top?.enabled ?? false;
  const dismissed = top?.prompt_dismissed_count ?? 0;

  return {
    ...usage,
    waiting,
    graceLeft: Math.max(GRACE_TEXTS_PER_MONTH - graceUsed, 0),
    autoTopUp: {
      enabled,
      packKey: top?.pack_key ?? TEXT_PACKS[0].key,
      triggerLeft: top?.trigger_left ?? 20,
      monthlyCapPence: top?.monthly_cap_pence ?? 5000,
      spentThisMonthPence: spent,
      pausedReason: top?.paused_reason ?? null,
      promptVisible: !enabled && usage.totalLeft <= LOW_TEXTS_AT && dismissed < PROMPT_MAX_DISMISSALS,
      promptDismissed: dismissed,
    },
    banner: pickBanner({
      totalLeft: usage.totalLeft,
      waitingCount: waiting.count,
      paused: enabled && top?.paused_reason != null,
    }),
  };
}
