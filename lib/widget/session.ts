import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { WIDGET_LIMITS } from '@/lib/widget/limits-config';

function sessionSecret(): string | null {
  const secret = process.env.WIDGET_SESSION_SECRET?.trim();
  return secret ? secret : null;
}

function mac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('base64url');
}

function sameMac(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function makeWidgetSession(
  clientId: string,
  conversationId: string,
  now?: Date,
): { token: string; expiresAt: Date } {
  const secret = sessionSecret();
  if (!secret) throw new Error('WIDGET_SESSION_SECRET is not set');
  const startMs = (now ?? new Date()).getTime();
  const expSeconds = Math.floor(startMs / 1000) + WIDGET_LIMITS.sessionSeconds;
  const expiresAt = new Date(expSeconds * 1000);
  const token = `${expSeconds}.${mac(secret, `${clientId}.${conversationId}.${expSeconds}`)}`;
  return { token, expiresAt };
}

/** False on: not a string, bad shape, expired, wrong mac, or a missing secret. */
export function verifyWidgetSession(
  token: unknown,
  clientId: string,
  conversationId: string,
  now?: Date,
): boolean {
  const secret = sessionSecret();
  if (!secret) return false;
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return false;
  const expPart = token.slice(0, dot);
  const macPart = token.slice(dot + 1);
  if (!/^\d+$/.test(expPart) || !/^[A-Za-z0-9_-]+$/.test(macPart)) return false;
  const expSeconds = Number(expPart);
  if (!Number.isSafeInteger(expSeconds)) return false;
  const nowMs = (now ?? new Date()).getTime();
  if (nowMs >= expSeconds * 1000) return false;
  const expected = mac(secret, `${clientId}.${conversationId}.${expSeconds}`);
  return sameMac(macPart, expected);
}
