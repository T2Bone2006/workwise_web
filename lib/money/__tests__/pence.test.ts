import { describe, expect, it } from 'vitest';
import {
  formatGbp,
  fromPence,
  parseMoneyInput,
  toPence,
} from '@/lib/money/pence';

describe('toPence / fromPence', () => {
  it('0.1 + 0.2 → 30p (float noise)', () => {
    expect(toPence(0.1 + 0.2)).toBe(30);
  });

  it('15.005 → 1501', () => {
    expect(toPence(15.005)).toBe(1501);
  });

  it('fromPence 1501 → 15.01', () => {
    expect(fromPence(1501)).toBe(15.01);
  });
});

describe('formatGbp', () => {
  it("formats 15 as '£15'", () => {
    expect(formatGbp(15)).toBe('£15');
  });

  it("formats 15.5 as '£15.50'", () => {
    expect(formatGbp(15.5)).toBe('£15.50');
  });

  it("formats 1250 as '£1,250'", () => {
    expect(formatGbp(1250)).toBe('£1,250');
  });

  it("formats 15 with always2dp as '£15.00'", () => {
    expect(formatGbp(15, { always2dp: true })).toBe('£15.00');
  });

  it("formats negative with unicode minus", () => {
    expect(formatGbp(-5)).toBe('\u2212£5');
  });

  it("null/undefined → '£0'", () => {
    expect(formatGbp(null)).toBe('£0');
    expect(formatGbp(undefined)).toBe('£0');
  });
});

describe('parseMoneyInput', () => {
  it("parses '£15.50' → 15.5", () => {
    expect(parseMoneyInput('£15.50')).toBe(15.5);
  });

  it("parses ' 1,250 ' → 1250", () => {
    expect(parseMoneyInput(' 1,250 ')).toBe(1250);
  });

  it("returns null for 'abc'", () => {
    expect(parseMoneyInput('abc')).toBeNull();
  });

  it("returns null for '-1'", () => {
    expect(parseMoneyInput('-1')).toBeNull();
  });
});
