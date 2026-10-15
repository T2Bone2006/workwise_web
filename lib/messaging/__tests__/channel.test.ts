import { describe, expect, it } from 'vitest';
import {
  channelOrderFor,
  contactChoiceFromColumn,
  contactChoiceToColumn,
  messageGroup,
} from '@/lib/messaging/channel';

const settings = {
  money_channel: 'email_first' as const,
  change_channel: 'text_first' as const,
};

describe('messageGroup', () => {
  it('groups kinds into reminder / money / change', () => {
    expect(messageGroup('reminder')).toBe('reminder');
    expect(messageGroup('visit_done')).toBe('money');
    expect(messageGroup('chaser')).toBe('money');
    expect(messageGroup('payment_received')).toBe('money');
    expect(messageGroup('visit_change')).toBe('change');
    expect(messageGroup('reply_ack')).toBe('change');
  });
});

describe('channelOrderFor', () => {
  it('sends nothing when the customer prefers none', () => {
    expect(channelOrderFor('reminder', 'none', settings)).toEqual([]);
    expect(channelOrderFor('visit_done', 'none', settings)).toEqual([]);
    expect(channelOrderFor('visit_change', 'none', settings)).toEqual([]);
  });

  it('forces text-only for reminders', () => {
    expect(channelOrderFor('reminder', null, settings)).toEqual(['text']);
    expect(channelOrderFor('reminder', 'email', settings)).toEqual(['text']);
    expect(channelOrderFor('reminder', 'sms', settings)).toEqual(['text']);
  });

  it('orders money and change channels from pref and business defaults', () => {
    expect(channelOrderFor('visit_done', 'sms', settings)).toEqual(['text', 'email']);
    expect(channelOrderFor('visit_done', 'whatsapp', settings)).toEqual([
      'text',
      'email',
    ]);
    expect(channelOrderFor('chaser', 'email', settings)).toEqual(['email', 'text']);
    expect(channelOrderFor('payment_received', null, settings)).toEqual([
      'email',
      'text',
    ]);
    expect(channelOrderFor('visit_change', null, settings)).toEqual(['text', 'email']);
    expect(channelOrderFor('reply_ack', 'email', settings)).toEqual(['email', 'text']);
  });
});

describe('contactChoiceFromColumn / contactChoiceToColumn', () => {
  it('maps form choices and treats whatsapp as text first', () => {
    expect(contactChoiceFromColumn(null)).toBe('default');
    expect(contactChoiceFromColumn('whatsapp')).toBe('sms');
    expect(contactChoiceFromColumn('sms')).toBe('sms');
    expect(contactChoiceToColumn('default')).toBeNull();
    expect(contactChoiceToColumn('sms')).toBe('sms');
  });
});
