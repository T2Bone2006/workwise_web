import { describe, expect, it } from 'vitest';
import { matchKeyword, normaliseReply } from '@/lib/messaging/keywords';

describe('normaliseReply / matchKeyword', () => {
  it('matches STOP / START / NO / CANCEL as exact normalised phrases', () => {
    expect(matchKeyword('STOP')).toBe('opt_out');
    expect(matchKeyword('Stop.')).toBe('opt_out');
    expect(matchKeyword(' stop ')).toBe('opt_out');
    expect(matchKeyword('Start')).toBe('opt_in');
    expect(matchKeyword('No')).toBe('said_no');
    expect(matchKeyword('no thanks!')).toBe('said_no');
    expect(matchKeyword('Cancel')).toBe('said_no');
  });

  it('returns null for non-exact phrases (AI decides later)', () => {
    expect(matchKeyword('No problem see you then')).toBeNull();
    expect(matchKeyword('stop by at 3')).toBeNull();
    expect(normaliseReply('Stop.')).toBe('stop');
  });
});
