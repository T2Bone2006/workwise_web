import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hashCode,
  LINK_TOKEN_RE,
  newCode,
  newLinkToken,
  newSessionToken,
  sameHash,
  sha256Hex,
} from '@/lib/accountant/tokens';

describe('tokens', () => {
  it('makes 43-character base64url link and session tokens whose hash is a sha256', () => {
    for (const make of [newLinkToken, newSessionToken]) {
      const t = make();
      expect(t.raw).toMatch(LINK_TOKEN_RE);
      expect(t.hash).toBe(sha256Hex(t.raw));
      expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('never repeats a token', () => {
    expect(new Set(Array.from({ length: 200 }, () => newLinkToken().raw)).size).toBe(200);
  });

  it('rejects things that are not link tokens', () => {
    for (const bad of ['', 'short', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}!`, "' or 1=1 --"]) {
      expect(LINK_TOKEN_RE.test(bad)).toBe(false);
    }
  });

  it('makes six-digit codes, with leading zeros kept', () => {
    for (let i = 0; i < 300; i += 1) expect(newCode()).toMatch(/^\d{6}$/);
  });
});

describe('code hashing', () => {
  const original = process.env.ACCOUNTANT_CODE_SECRET;
  beforeEach(() => {
    process.env.ACCOUNTANT_CODE_SECRET = 'test-secret-one';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ACCOUNTANT_CODE_SECRET;
    else process.env.ACCOUNTANT_CODE_SECRET = original;
  });

  it('is keyed: the same code under another secret or another access hashes differently', () => {
    const a = hashCode('123456', 'access-1');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode('123456', 'access-1')).toBe(a);
    expect(hashCode('123456', 'access-2')).not.toBe(a);
    process.env.ACCOUNTANT_CODE_SECRET = 'test-secret-two';
    expect(hashCode('123456', 'access-1')).not.toBe(a);
  });

  it('is not a plain hash of the code', () => {
    expect(hashCode('123456', 'access-1')).not.toBe(sha256Hex('123456'));
    expect(hashCode('123456', 'access-1')).not.toBe(sha256Hex('access-1:123456'));
  });

  it('throws rather than fall back to an unkeyed hash when the secret is missing', () => {
    delete process.env.ACCOUNTANT_CODE_SECRET;
    expect(() => hashCode('123456', 'access-1')).toThrow('ACCOUNTANT_CODE_SECRET not set');
    process.env.ACCOUNTANT_CODE_SECRET = '   ';
    expect(() => hashCode('123456', 'access-1')).toThrow('ACCOUNTANT_CODE_SECRET not set');
  });
});

describe('sameHash', () => {
  it('compares equal strings, and refuses different or different-length ones', () => {
    expect(sameHash('abc123', 'abc123')).toBe(true);
    expect(sameHash('abc123', 'abc124')).toBe(false);
    expect(sameHash('abc', 'abcd')).toBe(false);
    expect(sameHash('', '')).toBe(true);
  });
});
