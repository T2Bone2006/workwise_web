import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isValidGoCardlessSignature } from '@/lib/gocardless/signature';

const secret = 'whsec_test_secret';
const body = '{"events":[{"id":"EV1"}]}';
const sign = (b: string, s = secret) => createHmac('sha256', s).update(b).digest('hex');

describe('isValidGoCardlessSignature', () => {
  it('accepts the right signature', () => {
    expect(isValidGoCardlessSignature(body, sign(body), secret)).toBe(true);
  });

  it('rejects a signature made with another secret or over another body', () => {
    expect(isValidGoCardlessSignature(body, sign(body, 'other'), secret)).toBe(false);
    expect(isValidGoCardlessSignature(body, sign('{"events":[]}'), secret)).toBe(false);
  });

  it('rejects a missing, empty, odd-length or non-hex header', () => {
    expect(isValidGoCardlessSignature(body, null, secret)).toBe(false);
    expect(isValidGoCardlessSignature(body, '', secret)).toBe(false);
    expect(isValidGoCardlessSignature(body, sign(body).slice(1), secret)).toBe(false);
    expect(isValidGoCardlessSignature(body, 'zz'.repeat(32), secret)).toBe(false);
    expect(isValidGoCardlessSignature(body, sign(body) + 'ab', secret)).toBe(false);
  });
});
