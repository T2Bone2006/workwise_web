import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  GoCardlessError,
  goCardlessClient,
  isRevokedError,
  type GoCardlessClient,
} from '@/lib/gocardless/client';
import { goCardlessConfig } from '@/lib/gocardless/config';
import { decryptToken } from '@/lib/gocardless/crypto';

export type ConnectionRow = {
  id: string;
  tenant_id: string;
  status: 'not_connected' | 'connected' | 'disconnected';
  organisation_id: string | null;
  creditor_id: string | null;
  connected_email: string | null;
  verification_status: 'successful' | 'in_review' | 'action_required' | null;
  verification_checked_at: string | null;
  mandates_checked_at: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  disconnect_reason: string | null;
};

/** The ConnectionRow columns (never access_token_enc / oauth_*). Tenant logins may read exactly these. */
export const CONNECTION_COLUMNS = [
  'id',
  'tenant_id',
  'status',
  'organisation_id',
  'creditor_id',
  'connected_email',
  'verification_status',
  'verification_checked_at',
  'mandates_checked_at',
  'connected_at',
  'disconnected_at',
  'disconnect_reason',
].join(', ');

const FIVE_MIN_MS = 5 * 60 * 1000;
const STATUSES = new Set(['not_connected', 'connected', 'disconnected']);
const VERIFICATION = new Set(['successful', 'in_review', 'action_required']);

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Validates a row from the database; null when it doesn't look like one. */
export function asConnectionRow(raw: unknown): ConnectionRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const tenantId = str(r.tenant_id);
  const status = str(r.status);
  if (!id || !tenantId || !status || !STATUSES.has(status)) return null;
  const verification = str(r.verification_status);
  return {
    id,
    tenant_id: tenantId,
    status: status as ConnectionRow['status'],
    organisation_id: str(r.organisation_id),
    creditor_id: str(r.creditor_id),
    connected_email: str(r.connected_email),
    verification_status:
      verification && VERIFICATION.has(verification)
        ? (verification as ConnectionRow['verification_status'])
        : null,
    verification_checked_at: str(r.verification_checked_at),
    mandates_checked_at: str(r.mandates_checked_at),
    connected_at: str(r.connected_at),
    disconnected_at: str(r.disconnected_at),
    disconnect_reason: str(r.disconnect_reason),
  };
}

function logGoCardless(label: string, tenantId: string, err: unknown): void {
  if (err instanceof GoCardlessError) {
    console.error(label, tenantId, {
      status: err.status,
      type: err.type,
      code: err.code,
      reasons: err.reasons,
      requestId: err.requestId,
    });
  } else {
    console.error(label, tenantId, err instanceof Error ? err.name : 'error');
  }
}

export async function getConnection(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ConnectionRow | null> {
  const { data, error } = await admin
    .from('gocardless_connections')
    .select(CONNECTION_COLUMNS)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) {
    console.error('[gocardless] getConnection', tenantId, error.code);
    return null;
  }
  return asConnectionRow(data);
}

/** The stored status (null = no row). Throws when the database can't be read, so callers retry instead of guessing. */
export async function connectionStatus(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ConnectionRow['status'] | null> {
  const { data, error } = await admin
    .from('gocardless_connections')
    .select('status')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`Reading GoCardless connection failed (${error.code ?? 'db'})`);
  const status = str((data as { status?: unknown } | null)?.status);
  return status && STATUSES.has(status) ? (status as ConnectionRow['status']) : null;
}

/** status connected only. */
export async function getConnectionByOrganisation(
  admin: SupabaseClient,
  organisationId: string,
): Promise<ConnectionRow | null> {
  const { data, error } = await admin
    .from('gocardless_connections')
    .select(CONNECTION_COLUMNS)
    .eq('organisation_id', organisationId)
    .eq('status', 'connected')
    .maybeSingle();
  if (error) {
    console.error('[gocardless] getConnectionByOrganisation', error.code);
    return null;
  }
  return asConnectionRow(data);
}

/** Decrypts this business's token and returns a client; null when not connected. Never exposes the token. */
export async function clientForTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ client: GoCardlessClient; connection: ConnectionRow } | null> {
  const { data, error } = await admin
    .from('gocardless_connections')
    .select(`${CONNECTION_COLUMNS}, access_token_enc`)
    .eq('tenant_id', tenantId)
    .eq('status', 'connected')
    .maybeSingle();
  if (error) {
    console.error('[gocardless] clientForTenant', tenantId, error.code);
    return null;
  }
  const connection = asConnectionRow(data);
  const enc = str((data as { access_token_enc?: unknown } | null)?.access_token_enc);
  if (!connection || !enc) return null;

  try {
    const token = decryptToken(enc, goCardlessConfig().tokenKey);
    return { client: goCardlessClient(token), connection };
  } catch (err) {
    // A wrong GOCARDLESS_TOKEN_KEY or a damaged value — never log the value.
    console.error('[gocardless] could not unlock the token', tenantId, err instanceof Error ? err.message : 'error');
    return null;
  }
}

/**
 * GET /creditors (first record) → verification_status, creditor_id,
 * verification_checked_at. If checkedAt is younger than minAgeMs (default
 * 5 min) and !force, returns the stored row unchanged. A revoked token →
 * markDisconnected(…, 'GoCardless access was removed'). Other errors → stored
 * row unchanged (logged).
 */
export async function refreshVerification(
  admin: SupabaseClient,
  tenantId: string,
  opts: { force?: boolean; minAgeMs?: number; now?: Date } = {},
): Promise<ConnectionRow | null> {
  const now = opts.now ?? new Date();
  const stored = await getConnection(admin, tenantId);
  if (!stored || stored.status !== 'connected') return stored;

  if (!opts.force && stored.verification_checked_at) {
    const age = now.getTime() - new Date(stored.verification_checked_at).getTime();
    if (Number.isFinite(age) && age >= 0 && age < (opts.minAgeMs ?? FIVE_MIN_MS)) {
      return stored;
    }
  }

  const unlocked = await clientForTenant(admin, tenantId);
  if (!unlocked) return stored;

  try {
    const json = await unlocked.client.get<{ creditors?: unknown[] }>('/creditors', { limit: 1 });
    const creditor = Array.isArray(json.creditors) ? json.creditors[0] : null;
    if (!creditor || typeof creditor !== 'object') return stored;
    const c = creditor as Record<string, unknown>;
    const verification = str(c.verification_status);

    const { data, error } = await admin
      .from('gocardless_connections')
      .update({
        creditor_id: str(c.id) ?? stored.creditor_id,
        verification_status:
          verification && VERIFICATION.has(verification) ? verification : stored.verification_status,
        verification_checked_at: now.toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('status', 'connected')
      .select(CONNECTION_COLUMNS)
      .maybeSingle();
    if (error) {
      console.error('[gocardless] refreshVerification update', tenantId, error.code);
      return stored;
    }
    return asConnectionRow(data) ?? stored;
  } catch (err) {
    if (isRevokedError(err)) {
      await markDisconnected(admin, tenantId, 'GoCardless access was removed');
      return getConnection(admin, tenantId);
    }
    logGoCardless('[gocardless] refreshVerification', tenantId, err);
    return stored;
  }
}

/**
 * status disconnected, disconnected_at, disconnect_reason, access_token_enc =
 * null. Idempotent. Pending/active Direct Debit rows are NOT touched (the
 * mandates still exist in GoCardless).
 */
export async function markDisconnected(
  admin: SupabaseClient,
  tenantId: string,
  reason: string,
): Promise<void> {
  const { error } = await admin
    .from('gocardless_connections')
    .update({
      status: 'disconnected',
      disconnected_at: new Date().toISOString(),
      disconnect_reason: reason.trim().slice(0, 200) || null,
      access_token_enc: null,
    })
    .eq('tenant_id', tenantId)
    .eq('status', 'connected');
  if (error) {
    console.error('[gocardless] markDisconnected', tenantId, error.code);
  }
}
