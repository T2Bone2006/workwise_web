import { describe, expect, it } from 'vitest';
import { addWorkingDays, directDebitCollectOn } from '@/lib/direct-debit/dates';

// 2026-10-05 is a Monday.
describe('addWorkingDays', () => {
  it('counts Mon–Fri only', () => {
    expect(addWorkingDays('2026-10-05', 1)).toBe('2026-10-06'); // Mon → Tue
    expect(addWorkingDays('2026-10-06', 3)).toBe('2026-10-09'); // Tue → Fri
    expect(addWorkingDays('2026-10-08', 3)).toBe('2026-10-13'); // Thu → Tue (skips the weekend)
  });

  it('starting on a weekend, the first working day is Monday', () => {
    expect(addWorkingDays('2026-10-10', 1)).toBe('2026-10-12'); // Sat → Mon
    expect(addWorkingDays('2026-10-11', 1)).toBe('2026-10-12'); // Sun → Mon
  });

  it('zero (or less) changes nothing; crosses a month end', () => {
    expect(addWorkingDays('2026-10-06', 0)).toBe('2026-10-06');
    expect(addWorkingDays('2026-10-06', -2)).toBe('2026-10-06');
    expect(addWorkingDays('2026-10-29', 3)).toBe('2026-11-03'); // Thu → Tue
  });
});

describe('directDebitCollectOn', () => {
  it('+3 working days when active, +5 when pending', () => {
    expect(directDebitCollectOn('2026-10-06', 'active')).toBe('2026-10-09'); // Tue → Fri
    expect(directDebitCollectOn('2026-10-06', 'pending')).toBe('2026-10-13'); // Tue → next Tue
    expect(directDebitCollectOn('2026-10-09', 'active')).toBe('2026-10-14'); // Fri → Wed
  });
});
