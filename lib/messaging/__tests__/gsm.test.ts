import { describe, expect, it } from 'vitest';
import { countSegments, isGsm7, toGsm7 } from '@/lib/messaging/gsm';

describe('toGsm7', () => {
  it('replaces curly quotes, dashes and ellipsis; strips emoji', () => {
    expect(toGsm7('Dave’s — “great”…')).toBe('Dave\'s - "great"...');
    expect(toGsm7('Hi 😀 there')).toBe('Hi there');
  });
});

describe('isGsm7 / countSegments', () => {
  it('counts GSM-7 segments at 160 / 153 and treats € as 2', () => {
    const oneSixty = 'a'.repeat(160);
    expect(isGsm7(oneSixty)).toBe(true);
    expect(countSegments(oneSixty)).toEqual({
      encoding: 'gsm7',
      length: 160,
      segments: 1,
    });
    expect(countSegments('a'.repeat(161))).toEqual({
      encoding: 'gsm7',
      length: 161,
      segments: 2,
    });
    expect(countSegments('a'.repeat(307))).toEqual({
      encoding: 'gsm7',
      length: 307,
      segments: 3,
    });
    expect(countSegments('€')).toEqual({ encoding: 'gsm7', length: 2, segments: 1 });
  });

  it('treats a string with emoji (before toGsm7) as UCS-2', () => {
    const withEmoji = 'Hi 😀';
    expect(isGsm7(withEmoji)).toBe(false);
    expect(countSegments(withEmoji).encoding).toBe('ucs2');
  });
});
