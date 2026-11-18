import { describe, expect, it } from 'vitest';
import { pickBanner } from '@/lib/data/messaging/texts-status';

describe('pickBanner', () => {
  it('nothing to say when there are plenty of texts', () => {
    expect(pickBanner({ totalLeft: 80, waitingCount: 0, paused: false })).toBe('none');
  });
  it('low at 20 and below', () => {
    expect(pickBanner({ totalLeft: 21, waitingCount: 0, paused: false })).toBe('none');
    expect(pickBanner({ totalLeft: 20, waitingCount: 0, paused: false })).toBe('low');
  });
  it('out at 0, even with messages waiting', () => {
    expect(pickBanner({ totalLeft: 0, waitingCount: 4, paused: false })).toBe('out');
  });
  it('waiting only once the business is back in credit', () => {
    expect(pickBanner({ totalLeft: 12, waitingCount: 2, paused: false })).toBe('waiting');
  });
  it('a paused auto top-up beats everything', () => {
    expect(pickBanner({ totalLeft: 0, waitingCount: 4, paused: true })).toBe('paused');
  });
});
