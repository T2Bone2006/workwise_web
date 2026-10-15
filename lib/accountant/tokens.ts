import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 32 random bytes as base64url is always 43 characters. Checked before any query. */
export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const SESSION_TOKEN_RE = LINK_TOKEN_RE;
export const CODE_RE = /^\d{6}$/;

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function newToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: sha256Hex(raw) };
}

/** The invite link's token. Only `hash` is ever stored. */
export function newLinkToken(): { raw: string; hash: string } {
  return newToken();
}

/** The session cookie's token. Only `hash` is ever stored. */
export function newSessionToken(): { raw: string; hash: string } {
  return newToken();
}

/** '000000'..'999999', uniformly random. */
export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** HMAC-SHA256(ACCOUNTANT_CODE_SECRET, accessId:code). Throws when the secret is missing: never an unkeyed hash. */
export function hashCode(code: string, accessId: string): string {
  const secret = process.env.ACCOUNTANT_CODE_SECRET?.trim();
  if (!secret) throw new Error('ACCOUNTANT_CODE_SECRET not set');
  return createHmac('sha256', secret).update(`${accessId}:${code}`, 'utf8').digest('hex');
}

/** Constant-time compare of two hex hashes. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
