import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

/** hex HMAC-SHA256(secret, rawBody) compared with crypto.timingSafeEqual; false for a missing/odd-length header. */
export function isValidGoCardlessSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): boolean {
  const given = header?.trim() ?? '';
  if (given === '' || given.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(given)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const actual = Buffer.from(given, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
