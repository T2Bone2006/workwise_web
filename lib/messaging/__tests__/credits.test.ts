import { describe, expect, it } from 'vitest';
import {
  TEXT_ALLOWANCE_PER_MONTH,
  TEXT_PACKS,
  summariseTexts,
  textPackByKey,
} from '@/lib/messaging/credits';

describe('text packs', () => {
  it('exposes the two packs and looks them up by key', () => {
    expect(TEXT_ALLOWANCE_PER_MONTH).toBe(100);
    expect(TEXT_PACKS).toHaveLength(2);
    expect(textPackByKey('texts_250')?.texts).toBe(250);
    expect(textPackByKey('texts_1000')?.pricePence).toBe(3500);
    expect(textPackByKey('nope')).toBeNull();
  });
});

describe('summariseTexts', () => {
  it('treats a missing row as a fresh month', () => {
    expect(summariseTexts(null, '2026-10')).toEqual({
      freeUsed: 0,
      freeLeft: 100,
      packLeft: 0,
      totalLeft: 100,
      allowance: 100,
    });
  });

  it('resets free usage when the row is from another month', () => {
    expect(
      summariseTexts(
        { month: '2026-09', month_used: 100, pack_balance: 20 },
        '2026-10',
      ),
    ).toEqual({
      freeUsed: 0,
      freeLeft: 100,
      packLeft: 20,
      totalLeft: 120,
      allowance: 100,
    });
  });
});
