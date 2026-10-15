import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { sha256Hex } from '@/lib/accountant/tokens';
import { WIDGET_LIMITS } from '@/lib/widget/limits-config';

function sessionSecret(): string {
  return process.env.WIDGET_SESSION_SECRET?.trim() ?? '';
}

/** First IP from x-forwarded-for, else x-real-ip, else 'unknown'. Never logged. */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  return 'unknown';
}

export function visitorHash(request: Request): string {
  const ip = clientIp(request);
  return sha256Hex(`${ip}|${sessionSecret()}`).slice(0, 32);
}

export async function claimUsage(
  admin: SupabaseClient,
  clientId: string,
  kind: 'conversation' | 'message',
): Promise<boolean> {
  const pMax = kind === 'conversation' ? WIDGET_LIMITS.conversationsPerDay : WIDGET_LIMITS.messagesPerDay;
  try {
    const { data, error } = await admin.rpc('claim_widget_usage', {
      p_client_id: clientId,
      p_kind: kind,
      p_max: pMax,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

export async function visitorConversationsLastHour(
  admin: SupabaseClient,
  clientId: string,
  hash: string,
): Promise<number | null> {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await admin
      .from('widget_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('visitor_hash', hash)
      .gte('created_at', since);
    if (error || typeof count !== 'number') return null;
    return count;
  } catch {
    return null;
  }
}
