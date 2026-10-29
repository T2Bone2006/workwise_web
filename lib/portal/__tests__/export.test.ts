import { describe, expect, it } from 'vitest';
import { choiceForStatuses, presetRange, rangeProblem } from '@/lib/portal/export';

describe('portal export choices', () => {
  it('works out the quick date picks', () => {
    expect(presetRange('this_month', '2026-10-28')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('last_month', '2026-10-28')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('last_month', '2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('this_month', '2026-12-10')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(presetRange('last_30', '2026-10-30')).toEqual({ from: '2026-10-01', to: '2026-10-30' });
    expect(presetRange('all', '2026-10-28')).toEqual({ from: '', to: '' });
  });

  it('matches the table status filter to a plain choice', () => {
    expect(choiceForStatuses([])).toBe('all');
    expect(choiceForStatuses(['completed'])).toBe('completed');
    expect(choiceForStatuses(['incomplete'])).toBe('incomplete');
    expect(choiceForStatuses(['paused', 'in_progress', 'accepted', 'assigned', 'pending_send', 'pending'])).toBe('todo');
    expect(choiceForStatuses(['assigned'])).toBe('screen');
  });

  it('flags a backwards range', () => {
    expect(rangeProblem('2026-10-10', '2026-10-01')).not.toBeNull();
    expect(rangeProblem('2026-10-01', '2026-10-10')).toBeNull();
    expect(rangeProblem('', '2026-10-10')).toBeNull();
  });
});
