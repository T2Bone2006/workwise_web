import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { LINK_TOKEN_RE, newLinkToken, sha256Hex } from '@/lib/accountant/tokens';

export const LEAD_TOKEN_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function issueLeadToken(
  admin: SupabaseClient,
  p: { tenantId: string; leadId: string; now?: Date },
): Promise<string | null> {
  const now = p.now ?? new Date();
  const { raw, hash } = newLinkToken();
  const { error } = await admin.from('lead_action_tokens').insert({
    tenant_id: p.tenantId,
    lead_id: p.leadId,
    token_hash: hash,
    expires_at: new Date(now.getTime() + LEAD_TOKEN_DAYS * DAY_MS).toISOString(),
  });
  if (error) {
    console.error('[lite lead]', p.leadId, 'token');
    return null;
  }
  return raw;
}

export type ResolvedToken = { tokenId: string; tenantId: string; leadId: string };

export async function resolveLeadToken(
  admin: SupabaseClient,
  raw: string,
  now?: Date,
): Promise<ResolvedToken | 'invalid' | 'expired' | 'error'> {
  if (!LINK_TOKEN_RE.test(raw)) return 'invalid';
  const { data, error } = await admin
    .from('lead_action_tokens')
    .select('id, tenant_id, lead_id, expires_at')
    .eq('token_hash', sha256Hex(raw))
    .maybeSingle();
  if (error) return 'error';
  if (!data || typeof data !== 'object') return 'invalid';
  const row = data as { id?: unknown; tenant_id?: unknown; lead_id?: unknown; expires_at?: unknown };
  if (typeof row.id !== 'string' || typeof row.tenant_id !== 'string' || typeof row.lead_id !== 'string') {
    return 'error';
  }
  const expires = typeof row.expires_at === 'string' ? new Date(row.expires_at) : null;
  if (!expires || Number.isNaN(expires.getTime())) return 'error';
  if (expires.getTime() < (now ?? new Date()).getTime()) return 'expired';
  return { tokenId: row.id, tenantId: row.tenant_id, leadId: row.lead_id };
}

export async function touchLeadToken(admin: SupabaseClient, tokenId: string): Promise<void> {
  try {
    await admin.from('lead_action_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tokenId);
  } catch {
    // A failed stamp must not stop the page.
  }
}
