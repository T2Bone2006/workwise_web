import { describe, expect, it } from 'vitest';
import { lookFromSettings } from '@/lib/data/tenant-look-core';

describe('lookFromSettings', () => {
  it('always gives Rounds and Lite the new look', () => {
    expect(lookFromSettings(false, null)).toBe('new');
    expect(lookFromSettings(false, { look: 'classic' })).toBe('new');
  });

  it('keeps Pro on the classic look until the business opts in', () => {
    expect(lookFromSettings(true, null)).toBe('classic');
    expect(lookFromSettings(true, {})).toBe('classic');
    expect(lookFromSettings(true, { look: 'classic' })).toBe('classic');
    expect(lookFromSettings(true, { look: 'new' })).toBe('new');
  });
});
