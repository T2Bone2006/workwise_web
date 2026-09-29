export type SmsEncoding = 'gsm7' | 'ucs2';

// GSM-7 basic alphabet (3GPP TS 23.038). Extension chars need an escape and count 2.
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

const GSM7_BASIC_SET = new Set(GSM7_BASIC);
const GSM7_EXT_SET = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);

function isGsm7Char(ch: string): boolean {
  return GSM7_BASIC_SET.has(ch) || GSM7_EXT_SET.has(ch);
}

/** Replace look-alikes with GSM-7, then REMOVE any character still outside GSM-7. */
export function toGsm7(text: string): string {
  let out = '';
  for (const ch of text) {
    let mapped: string;
    switch (ch) {
      case '\u2018': // ‘
      case '\u2019': // ’
      case '\u201A': // ‚
      case '\u201B': // ‛
      case '\u2032': // ′
        mapped = "'";
        break;
      case '\u201C': // “
      case '\u201D': // ”
      case '\u201E': // „
      case '\u2033': // ″
        mapped = '"';
        break;
      case '\u2013': // –
      case '\u2014': // —
      case '\u2212': // −
        mapped = '-';
        break;
      case '\u2026': // …
        mapped = '...';
        break;
      case '\u00A0': // NBSP
        mapped = ' ';
        break;
      case '\u2022': // •
        mapped = '-';
        break;
      default:
        mapped = ch;
    }
    for (const m of mapped) {
      if (isGsm7Char(m)) out += m;
    }
  }
  return out.replace(/ {2,}/g, ' ');
}

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!isGsm7Char(ch)) return false;
  }
  return true;
}

function gsm7Length(text: string): number {
  let len = 0;
  for (const ch of text) {
    len += GSM7_EXT_SET.has(ch) ? 2 : 1;
  }
  return len;
}

/** GSM-7: extension chars count 2. 1 segment ≤ 160, else ceil(len/153).
 *  UCS-2: 1 segment ≤ 70, else ceil(len/67). */
export function countSegments(text: string): {
  encoding: SmsEncoding;
  length: number;
  segments: number;
} {
  if (isGsm7(text)) {
    const length = gsm7Length(text);
    const segments = length === 0 ? 0 : length <= 160 ? 1 : Math.ceil(length / 153);
    return { encoding: 'gsm7', length, segments };
  }
  const length = [...text].length;
  const segments = length === 0 ? 0 : length <= 70 ? 1 : Math.ceil(length / 67);
  return { encoding: 'ucs2', length, segments };
}
