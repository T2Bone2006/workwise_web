import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  CODE_RE,
  hashCode,
  LINK_TOKEN_RE,
  newCode,
  newLinkToken,
  newSessionToken,
  sameHash,
  SESSION_TOKEN_RE,
  sha256Hex,
} from '@/lib/accountant/tokens';

export const SESSION_COOKIE = 'ww_accountant';
/** Signed in on a device for 30 days after one code. Removing the accountant still ends it at once. */
export const SESSION_DAYS = 30;
export const SESSION_HOURS = SESSION_DAYS * 24;
export const CODE_MINUTES = 10;
const MAX_CODES_PER_HOUR = 5;
const MAX_TRIES_PER_CODE = 5;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export type AccessSummary = {
  id: string;
  email: string;
  name: string | null;
  invitedAt: string;
  lastViewedAt: string | null;
};

const INVALID_EMAIL = 'Enter a valid email address.';
const ALREADY_HAS_ACCESS = 'That accountant already has access.';
const NO_LONGER_HAS_ACCESS = 'That accountant no longer has access.';
const FAILED = "Couldn't do that. Try again.";

type Failure = { ok: false; error: string };

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/** Log the error's code or name only: never a token, code or email. */
function logFailure(where: string, accessId: string | null, error: unknown): void {
  const detail =
    typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code)
      : error instanceof Error
        ? error.name
        : 'unknown';
  console.error(`[accountant:${where}]`, { accessId, error: detail });
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

/** Active accountants only, newest invite first. */
export async function listAccess(admin: SupabaseClient, tenantId: string): Promise<AccessSummary[]> {
  const { data, error } = await admin
    .from('accountant_access')
    .select('id, email, name, invited_at, last_viewed_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('invited_at', { ascending: false });
  if (error) {
    logFailure('listAccess', null, error);
    throw new Error('Could not load accountants');
  }
  return (data ?? []).map((r) => ({
    id: String(r.id),
    email: String(r.email),
    name: (r.name as string | null) ?? null,
    invitedAt: String(r.invited_at),
    lastViewedAt: (r.last_viewed_at as string | null) ?? null,
  }));
}

/** Creates the access row. The raw link token goes back to the caller (for the email) and nowhere else. */
export async function inviteAccountant(
  admin: SupabaseClient,
  p: { tenantId: string; userId: string | null; email: string; name?: string | null },
): Promise<{ ok: true; accessId: string; linkToken: string } | Failure> {
  const email = z.email().safeParse(p.email.trim().toLowerCase());
  if (!email.success) return { ok: false, error: INVALID_EMAIL };

  const token = newLinkToken();
  const accessId = crypto.randomUUID();
  const name = p.name?.trim().slice(0, 100) || null;

  const { error } = await admin.from('accountant_access').insert({
    id: accessId,
    tenant_id: p.tenantId,
    email: email.data,
    name,
    link_token_hash: token.hash,
    invited_by_user_id: p.userId,
  });
  if (error) {
    if (isUniqueViolation(error)) return { ok: false, error: ALREADY_HAS_ACCESS };
    logFailure('invite', null, error);
    return { ok: false, error: FAILED };
  }
  return { ok: true, accessId, linkToken: token.raw };
}

/** A new link for an existing accountant. The old link stops working at once. */
export async function resendInvite(
  admin: SupabaseClient,
  p: { tenantId: string; accessId: string },
): Promise<{ ok: true; linkToken: string; email: string } | Failure> {
  const token = newLinkToken();
  const { data, error } = await admin
    .from('accountant_access')
    .update({ link_token_hash: token.hash })
    .eq('id', p.accessId)
    .eq('tenant_id', p.tenantId)
    .eq('status', 'active')
    .select('email');
  if (error) {
    logFailure('resend', p.accessId, error);
    return { ok: false, error: FAILED };
  }
  if (!data || data.length === 0) return { ok: false, error: NO_LONGER_HAS_ACCESS };
  return { ok: true, linkToken: token.raw, email: String(data[0].email) };
}

/** Remove access and end every session, so it stops on the accountant's very next page load. */
export async function removeAccountant(
  admin: SupabaseClient,
  p: { tenantId: string; accessId: string; userId: string | null },
): Promise<{ ok: true } | Failure> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('accountant_access')
    .update({ status: 'removed', removed_at: now, removed_by_user_id: p.userId })
    .eq('id', p.accessId)
    .eq('tenant_id', p.tenantId)
    .eq('status', 'active')
    .select('id');
  if (error) {
    logFailure('remove', p.accessId, error);
    return { ok: false, error: FAILED };
  }
  if (!data || data.length === 0) return { ok: false, error: NO_LONGER_HAS_ACCESS };

  const { error: sessionError } = await admin
    .from('accountant_sessions')
    .update({ ended_at: now })
    .eq('access_id', p.accessId)
    .is('ended_at', null);
  // Even if this fails, loadAccountantContext checks the access row's status on every load.
  if (sessionError) logFailure('remove-sessions', p.accessId, sessionError);
  return { ok: true };
}

type AccessRow = { id: string; tenant_id: string; email: string };

async function findActiveAccess(admin: SupabaseClient, linkToken: string): Promise<AccessRow | null> {
  if (!LINK_TOKEN_RE.test(linkToken)) return null;
  const { data, error } = await admin
    .from('accountant_access')
    .select('id, tenant_id, email')
    .eq('link_token_hash', sha256Hex(linkToken))
    .eq('status', 'active')
    .maybeSingle();
  if (error) {
    logFailure('findAccess', null, error);
    return null;
  }
  return (data as AccessRow | null) ?? null;
}

async function businessNameOf(admin: SupabaseClient, tenantId: string): Promise<string> {
  const { data } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle();
  const name = (data as { name?: string } | null)?.name?.trim();
  return name || 'your client';
}

/**
 * The link was opened: make a fresh 6-digit code. The raw code goes back to the
 * caller (for the email) and is stored only as a keyed hash.
 */
export async function issueLoginCode(
  admin: SupabaseClient,
  linkToken: string,
): Promise<
  | { ok: true; accessId: string; email: string; code: string; businessName: string }
  | { ok: false; error: 'not_found' | 'too_many' | 'failed' }
> {
  if (!LINK_TOKEN_RE.test(linkToken)) return { ok: false, error: 'not_found' };
  if (!process.env.ACCOUNTANT_CODE_SECRET?.trim()) {
    console.error('[accountant:issueLoginCode] ACCOUNTANT_CODE_SECRET not set');
    return { ok: false, error: 'failed' };
  }

  const access = await findActiveAccess(admin, linkToken);
  if (!access) return { ok: false, error: 'not_found' };

  const { count, error: countError } = await admin
    .from('accountant_login_codes')
    .select('id', { count: 'exact', head: true })
    .eq('access_id', access.id)
    .gte('created_at', hoursAgo(1));
  if (countError || count == null) {
    logFailure('issue-count', access.id, countError);
    return { ok: false, error: 'failed' };
  }
  if (count >= MAX_CODES_PER_HOUR) return { ok: false, error: 'too_many' };

  const code = newCode();
  const { error } = await admin.from('accountant_login_codes').insert({
    access_id: access.id,
    code_hash: hashCode(code, access.id),
    expires_at: minutesFromNow(CODE_MINUTES),
  });
  if (error) {
    logFailure('issue-insert', access.id, error);
    return { ok: false, error: 'failed' };
  }

  return {
    ok: true,
    accessId: access.id,
    email: access.email,
    code,
    businessName: await businessNameOf(admin, access.tenant_id),
  };
}

/** Check the code the accountant typed; on success start a 30-day session on this device. */
export async function verifyLoginCode(
  admin: SupabaseClient,
  p: { linkToken: string; code: string },
): Promise<
  | { ok: true; sessionToken: string; expiresAt: string }
  | { ok: false; error: 'not_found' | 'wrong_code' | 'expired' | 'failed' }
> {
  if (!process.env.ACCOUNTANT_CODE_SECRET?.trim()) {
    console.error('[accountant:verifyLoginCode] ACCOUNTANT_CODE_SECRET not set');
    return { ok: false, error: 'failed' };
  }
  const access = await findActiveAccess(admin, p.linkToken);
  if (!access) return { ok: false, error: 'not_found' };

  // The newest code that is still usable.
  const { data: codes, error: codeError } = await admin
    .from('accountant_login_codes')
    .select('id, code_hash, attempts')
    .eq('access_id', access.id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .lt('attempts', MAX_TRIES_PER_CODE)
    .order('created_at', { ascending: false })
    .limit(1);
  if (codeError) {
    logFailure('verify-find', access.id, codeError);
    return { ok: false, error: 'failed' };
  }
  const row = (codes ?? [])[0] as { id: string; code_hash: string; attempts: number } | undefined;
  if (!row) return { ok: false, error: 'expired' };

  // Something that cannot be a code never costs a try and can never be right.
  if (!CODE_RE.test(p.code)) return { ok: false, error: 'wrong_code' };

  // Take a try before comparing. Compare-and-swap on `attempts`, so two requests
  // at once cannot both spend the same try, and a lost race fails closed.
  const { data: claimed, error: claimError } = await admin
    .from('accountant_login_codes')
    .update({ attempts: row.attempts + 1 })
    .eq('id', row.id)
    .eq('attempts', row.attempts)
    .lt('attempts', MAX_TRIES_PER_CODE)
    .is('used_at', null)
    .select('attempts');
  if (claimError) {
    logFailure('verify-claim', access.id, claimError);
    return { ok: false, error: 'failed' };
  }
  if (!claimed || claimed.length === 0) return { ok: false, error: 'expired' };

  if (!sameHash(hashCode(p.code, access.id), row.code_hash)) return { ok: false, error: 'wrong_code' };

  // A code works once: only one request can flip used_at.
  const { data: used, error: usedError } = await admin
    .from('accountant_login_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .select('id');
  if (usedError) {
    logFailure('verify-use', access.id, usedError);
    return { ok: false, error: 'failed' };
  }
  if (!used || used.length === 0) return { ok: false, error: 'expired' };

  const session = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString();
  const { error: sessionError } = await admin.from('accountant_sessions').insert({
    access_id: access.id,
    session_token_hash: session.hash,
    expires_at: expiresAt,
  });
  if (sessionError) {
    logFailure('verify-session', access.id, sessionError);
    return { ok: false, error: 'failed' };
  }
  await admin.from('accountant_access').update({ last_viewed_at: new Date().toISOString() }).eq('id', access.id);

  return { ok: true, sessionToken: session.raw, expiresAt };
}

export type AccountantContext = {
  accessId: string;
  tenantId: string;
  email: string;
  businessName: string;
};

/**
 * Which business may this visitor see? The tenant comes ONLY from the access row
 * the link token points to (T8); never from the URL or the cookie. Anything
 * wrong, including a database error, gives null.
 */
export async function loadAccountantContext(
  admin: SupabaseClient,
  p: { linkToken: string; sessionToken: string | undefined },
): Promise<AccountantContext | null> {
  if (!p.sessionToken || !SESSION_TOKEN_RE.test(p.sessionToken)) return null;
  const access = await findActiveAccess(admin, p.linkToken);
  if (!access) return null;

  const { data, error } = await admin
    .from('accountant_sessions')
    .select('id, last_seen_at')
    .eq('session_token_hash', sha256Hex(p.sessionToken))
    .eq('access_id', access.id)
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) {
    logFailure('context', access.id, error);
    return null;
  }
  const session = data as { id: string; last_seen_at: string } | null;
  if (!session) return null;

  if (Date.now() - new Date(session.last_seen_at).getTime() > TOUCH_EVERY_MS) {
    const now = new Date().toISOString();
    await Promise.all([
      admin.from('accountant_sessions').update({ last_seen_at: now }).eq('id', session.id),
      admin.from('accountant_access').update({ last_viewed_at: now }).eq('id', access.id),
    ]).catch((e) => logFailure('touch', access.id, e));
  }

  return {
    accessId: access.id,
    tenantId: access.tenant_id,
    email: access.email,
    businessName: await businessNameOf(admin, access.tenant_id),
  };
}

/** Sign out: end this session. */
export async function endSession(admin: SupabaseClient, sessionToken: string): Promise<void> {
  if (!SESSION_TOKEN_RE.test(sessionToken)) return;
  const { error } = await admin
    .from('accountant_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('session_token_hash', sha256Hex(sessionToken))
    .is('ended_at', null);
  if (error) logFailure('endSession', null, error);
}

/**
 * What the sign-in screen may say about a valid link: the business and the
 * address the code goes to. Null for a bad link or a removed accountant, so a
 * dead link never reveals that it once existed.
 */
export async function describeLink(
  admin: SupabaseClient,
  linkToken: string,
): Promise<{ email: string; businessName: string } | null> {
  const access = await findActiveAccess(admin, linkToken);
  if (!access) return null;
  return { email: access.email, businessName: await businessNameOf(admin, access.tenant_id) };
}
