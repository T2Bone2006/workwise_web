import { describe, expect, it } from 'vitest';
import { pinOf, samePin } from '@/lib/rounds/pin';

describe('pinOf', () => {
  it('returns the dropped spot when both numbers are there', () => {
    expect(pinOf({ pin_lat: 53.48, pin_lng: -2.24 })).toEqual({ lat: 53.48, lng: -2.24 });
  });

  it('returns null when the form sent no pin', () => {
    expect(pinOf({})).toBeNull();
    expect(pinOf({ pin_lat: null, pin_lng: null })).toBeNull();
    expect(pinOf({ pin_lat: 53.48, pin_lng: null })).toBeNull();
  });
});

describe('samePin', () => {
  it('treats positions within a metre as the same spot', () => {
    expect(samePin({ lat: 53.480001, lng: -2.24 }, { lat: 53.48, lng: -2.24 })).toBe(true);
  });

  it('treats a move of a street or more as a new spot', () => {
    expect(samePin({ lat: 53.481, lng: -2.24 }, { lat: 53.48, lng: -2.24 })).toBe(false);
  });

  it('never matches a service with no position yet', () => {
    expect(samePin({ lat: null, lng: null }, { lat: 53.48, lng: -2.24 })).toBe(false);
  });
});
