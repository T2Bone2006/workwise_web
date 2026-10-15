import { afterEach, describe, expect, it } from 'vitest';
import {
  appBaseUrl,
  generatePayToken,
  invoiceLinkUrl,
  payLinkUrl,
} from '@/lib/payments/tokens';

describe('generatePayToken', () => {
  it('returns 32 base64url chars', () => {
    const token = generatePayToken();
    expect(token).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('two calls differ', () => {
    expect(generatePayToken()).not.toBe(generatePayToken());
  });
});

describe('pay / invoice link URLs', () => {
  const prev = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prev;
  });

  it('strips trailing slash from the app base URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.joinworkwise.com/';
    expect(appBaseUrl()).toBe('https://app.joinworkwise.com');
    expect(payLinkUrl('abc')).toBe('https://app.joinworkwise.com/pay/abc');
    expect(invoiceLinkUrl('xyz')).toBe(
      'https://app.joinworkwise.com/pay/i/xyz',
    );
  });
});
