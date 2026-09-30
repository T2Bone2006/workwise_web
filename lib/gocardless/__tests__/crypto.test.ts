import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, sha256Hex } from '@/lib/gocardless/crypto';

const key = randomBytes(32);
const token = 'sandbox_Abc123-not-a-real-token';

describe('encryptToken / decryptToken', () => {
  it('round trips', () => {
    const enc = encryptToken(token, key);
    expect(enc).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(enc).not.toContain(token);
    expect(decryptToken(enc, key)).toBe(token);
  });

  it('uses a fresh iv every time', () => {
    const a = encryptToken(token, key);
    const b = encryptToken(token, key);
    expect(a).not.toBe(b);
    expect(Buffer.from(a.split(':')[1], 'base64')).toHaveLength(12);
  });

  it('refuses a changed byte', () => {
    const [v, iv, tag, ct] = encryptToken(token, key).split(':');
    const bytes = Buffer.from(ct, 'base64');
    bytes[0] ^= 0x01;
    expect(() => decryptToken([v, iv, tag, bytes.toString('base64')].join(':'), key)).toThrow();
  });

  it('refuses the wrong key', () => {
    const enc = encryptToken(token, key);
    expect(() => decryptToken(enc, randomBytes(32))).toThrow();
  });

  it('refuses a bad format', () => {
    expect(() => decryptToken('not-a-token', key)).toThrow('Bad token format');
    expect(() => decryptToken('v2:a:b:c', key)).toThrow('Bad token format');
  });
});

describe('sha256Hex', () => {
  it('hashes to lowercase hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
