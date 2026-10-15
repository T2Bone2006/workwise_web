import { describe, expect, it } from 'vitest';
import { lookFromSettings } from '@/lib/data/tenant-look-core';

describe('lookFromSettings', () => {
  it('gives every business the new look, Pro included, whatever an old setting says', () => {
    expect(lookFromSettings(false, null)).toBe('new');
    expect(lookFromSettings(true, null)).toBe('new');
    expect(lookFromSettings(true, {})).toBe('new');
    expect(lookFromSettings(true, { look: 'classic' })).toBe('new');
    expect(lookFromSettings(true, { look: 'new' })).toBe('new');
  });
});
