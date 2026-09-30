import 'server-only';

import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { goCardlessConfig } from '@/lib/gocardless/config';
import {
  getConnectionByOrganisation,
  markDisconnected,
  refreshVerification,
} from '@/lib/gocardless/connection';
import { decryptToken, encryptToken, sha256Hex } from '@/lib/gocardless/crypto';
import { refreshMandateLinks } from '@/lib/direct-debit/existing';

export type ConnectOutcome = 'connected' | 'cancelled' | 'expired' | 'taken' | 'error';

const STATE_TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 20_000;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

async function postForm(url: string, fields: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
}

/** POST <connectBase>/oauth/revoke. GoCardless answers 200 whatever happens; errors are logged only. */
async function revokeToken(token: string): Promise<void> {
  try {
    const config = goCardlessConfig();
    const res = await postForm(`${config.connectBase}/oauth/revoke`, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      token,
    });
    if (!res.ok) console.error('[gocardless] revoke answered', res.status);
  } catch (err) {
    console.error('[gocardless] revoke failed', err instanceof Error ? err.name : 'error');
  }
}

/**
 * Upserts the business's gocardless_connections row (tenant_id unique):
 * oauth_state_hash = sha256Hex(state), oauth_state_expires_at = now + 30 min,
 * oauth_from = from. Status is left as it is. Returns the authorise URL.
 */
export async function startGoCardlessConnect(
  admin: SupabaseClient,
  p: {
    tenantId: string;
    from: 'web' | 'app';
    hasAccount: boolean;
    prefill: {
      email: string | null;
      givenName: string | null;
      familyName: string | null;
      businessName: string;
    };
    now?: Date;
  },
): Promise<string> {
  const config = goCardlessConfig();
  const now = p.now ?? new Date();
  const state = randomBytes(32).toString('base64url');

  const { error } = await admin.from('gocardless_connections').upsert(
    {
      tenant_id: p.tenantId,
      oauth_state_hash: sha256Hex(state),
      oauth_state_expires_at: new Date(now.getTime() + STATE_TTL_MS).toISOString(),
      oauth_from: p.from,
    },
    { onConflict: 'tenant_id' },
  );
  if (error) {
    throw new Error(`Could not start GoCardless connect (${error.code ?? 'db'})`);
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    scope: 'read_write',
    redirect_uri: config.redirectUri,
    state,
    initial_view: p.hasAccount ? 'login' : 'signup',
  });
  const prefill: [string, string | null][] = [
    ['prefill[email]', str(p.prefill.email)],
    ['prefill[given_name]', str(p.prefill.givenName)],
    ['prefill[family_name]', str(p.prefill.familyName)],
    ['prefill[organisation_name]', str(p.prefill.businessName)],
    ['prefill[country_code]', 'GB'],
  ];
  for (const [key, value] of prefill) {
    if (value) params.set(key, value);
  }
  return `${config.connectBase}/oauth/authorize?${params.toString()}`;
}

type ExchangeResult = { accessToken: string; organisationId: string; email: string | null };

async function exchangeCode(code: string): Promise<ExchangeResult | null> {
  try {
    const config = goCardlessConfig();
    const res = await postForm(`${config.connectBase}/oauth/access_token`, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // GoCardless's `error` field only (e.g. invalid_grant) — never the code.
      console.error('[gocardless] code exchange refused', res.status, str(json.error));
      return null;
    }
    const accessToken = str(json.access_token);
    const organisationId = str(json.organisation_id);
    if (!accessToken || !organisationId) {
      console.error('[gocardless] code exchange: missing token or organisation');
      return null;
    }
    return { accessToken, organisationId, email: str(json.email) };
  } catch (err) {
    console.error('[gocardless] code exchange failed', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/** The callback's work. Never throws. */
export async function completeGoCardlessConnect(
  admin: SupabaseClient,
  p: { state: string | null; code: string | null; error: string | null; now?: Date },
): Promise<{ outcome: ConnectOutcome; from: 'web' | 'app'; tenantId: string | null }> {
  const now = p.now ?? new Date();
  const fail = (from: 'web' | 'app' = 'web', tenantId: string | null = null) => ({
    outcome: 'error' as const,
    from,
    tenantId,
  });

  try {
    const state = str(p.state);
    if (!state) return fail();
    const hash = sha256Hex(state);

    // 1. Find the business by the state's hash, then clear it so the link works once.
    const { data: row, error: findError } = await admin
      .from('gocardless_connections')
      .select('tenant_id, oauth_from, oauth_state_expires_at')
      .eq('oauth_state_hash', hash)
      .maybeSingle();
    if (findError) {
      console.error('[gocardless] callback lookup', findError.code);
      return fail();
    }
    const tenantId = str((row as { tenant_id?: unknown } | null)?.tenant_id);
    if (!row || !tenantId) return fail();
    const from: 'web' | 'app' =
      (row as { oauth_from?: unknown }).oauth_from === 'app' ? 'app' : 'web';
    const expiresAt = str((row as { oauth_state_expires_at?: unknown }).oauth_state_expires_at);

    const { data: cleared, error: clearError } = await admin
      .from('gocardless_connections')
      .update({ oauth_state_hash: null, oauth_state_expires_at: null, oauth_from: null })
      .eq('tenant_id', tenantId)
      .eq('oauth_state_hash', hash)
      .select('tenant_id');
    if (clearError || !Array.isArray(cleared) || cleared.length === 0) {
      // Someone used this link a moment ago.
      return fail(from, tenantId);
    }

    // 2. Expired.
    if (!expiresAt || new Date(expiresAt).getTime() <= now.getTime()) {
      return { outcome: 'expired', from, tenantId };
    }

    // 3. Cancelled / no code.
    if (str(p.error)) return { outcome: 'cancelled', from, tenantId };
    const code = str(p.code);
    if (!code) return fail(from, tenantId);

    // 4. Exchange the code (GoCardless allows 5 minutes).
    const exchanged = await exchangeCode(code);
    if (!exchanged) return fail(from, tenantId);

    // 5. Already connected to a different WorkWise business.
    const existing = await getConnectionByOrganisation(admin, exchanged.organisationId);
    if (existing && existing.tenant_id !== tenantId) {
      await revokeToken(exchanged.accessToken);
      return { outcome: 'taken', from, tenantId };
    }

    // 6. Store the connection (verification is re-read in step 7).
    const { error: saveError } = await admin
      .from('gocardless_connections')
      .update({
        status: 'connected',
        organisation_id: exchanged.organisationId,
        access_token_enc: encryptToken(exchanged.accessToken, goCardlessConfig().tokenKey),
        connected_email: exchanged.email ? exchanged.email.slice(0, 254) : null,
        connected_at: now.toISOString(),
        disconnected_at: null,
        disconnect_reason: null,
        creditor_id: null,
        verification_status: null,
        verification_checked_at: null,
      })
      .eq('tenant_id', tenantId);
    if (saveError) {
      if (saveError.code === '23505') {
        // Another business connected the same organisation at the same moment.
        await revokeToken(exchanged.accessToken);
        return { outcome: 'taken', from, tenantId };
      }
      console.error('[gocardless] save connection', saveError.code);
      return fail(from, tenantId);
    }

    // 7. What GoCardless knows about the business's verification.
    try {
      await refreshVerification(admin, tenantId, { force: true, now });
    } catch (err) {
      console.error('[gocardless] verification after connect', err instanceof Error ? err.name : 'error');
    }

    // 8. Existing Direct Debits (D21). GoCardless unreachable → logged; the review page's Check again retries.
    try {
      await refreshMandateLinks(admin, tenantId, now);
    } catch (err) {
      console.error('[gocardless] existing mandates after connect', err instanceof Error ? err.name : 'error');
    }

    return { outcome: 'connected', from, tenantId };
  } catch (err) {
    console.error('[gocardless] completeGoCardlessConnect', err instanceof Error ? err.name : 'error');
    return fail();
  }
}

/**
 * Revokes the token at GoCardless, then markDisconnected(…, 'Disconnected in
 * WorkWise'). A revoke network error is logged; the business is still
 * disconnected here. Direct Debit rows are never touched.
 */
export async function disconnectGoCardless(
  admin: SupabaseClient,
  p: { tenantId: string },
): Promise<void> {
  const { data, error } = await admin
    .from('gocardless_connections')
    .select('access_token_enc')
    .eq('tenant_id', p.tenantId)
    .eq('status', 'connected')
    .maybeSingle();
  if (error) {
    console.error('[gocardless] disconnect lookup', error.code);
  }
  const enc = str((data as { access_token_enc?: unknown } | null)?.access_token_enc);
  if (enc) {
    try {
      await revokeToken(decryptToken(enc, goCardlessConfig().tokenKey));
    } catch (err) {
      console.error('[gocardless] disconnect unlock', err instanceof Error ? err.message : 'error');
    }
  }
  await markDisconnected(admin, p.tenantId, 'Disconnected in WorkWise');
}
