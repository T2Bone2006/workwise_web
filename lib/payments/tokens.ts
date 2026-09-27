import { randomBytes } from 'node:crypto';

/** 32-char base64url from 24 random bytes. Used for customers.pay_link_token. */
export function generatePayToken(): string {
  return randomBytes(24).toString('base64url');
}

/** NEXT_PUBLIC_APP_URL without trailing slash; throws if missing. */
export function appBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) {
    throw new Error('NEXT_PUBLIC_APP_URL is not set');
  }
  return raw.replace(/\/+$/, '');
}

export function payLinkUrl(token: string): string {
  return `${appBaseUrl()}/pay/${token}`;
}

export function invoiceLinkUrl(token: string): string {
  return `${appBaseUrl()}/pay/i/${token}`;
}
