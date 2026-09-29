export type MessageKind =
  | 'reminder'
  | 'visit_done'
  | 'chaser'
  | 'payment_received'
  | 'visit_change'
  | 'reply_ack';

export type MessageGroup = 'reminder' | 'money' | 'change';
export type Channel = 'text' | 'email';
export type ChannelOrder = 'email_first' | 'text_first';
export type CustomerChannelPref = 'sms' | 'whatsapp' | 'email' | 'none' | null;

export type ContactChoice = 'default' | 'sms' | 'email' | 'none';

export const CONTACT_CHOICE_LABELS: Record<ContactChoice, string> = {
  default: 'Business default',
  sms: 'Text first',
  email: 'Email first',
  none: 'No messages',
};

export function messageGroup(kind: MessageKind): MessageGroup {
  if (kind === 'reminder') return 'reminder';
  if (kind === 'visit_change' || kind === 'reply_ack') return 'change';
  return 'money';
}

function orderFromPref(
  pref: CustomerChannelPref,
  businessDefault: ChannelOrder,
): Channel[] {
  if (pref === 'none') return [];
  if (pref === 'sms' || pref === 'whatsapp') return ['text', 'email'];
  if (pref === 'email') return ['email', 'text'];
  // null / business default
  return businessDefault === 'text_first' ? ['text', 'email'] : ['email', 'text'];
}

/** Order to try. [] = send nothing. */
export function channelOrderFor(
  kind: MessageKind,
  pref: CustomerChannelPref,
  settings: { money_channel: ChannelOrder; change_channel: ChannelOrder },
): Channel[] {
  if (pref === 'none') return [];
  if (kind === 'reminder') return ['text'];
  const group = messageGroup(kind);
  if (group === 'money') return orderFromPref(pref, settings.money_channel);
  return orderFromPref(pref, settings.change_channel);
}

/** Form value <-> column value. 'default' <-> null. 'whatsapp' reads as 'sms'. */
export function contactChoiceFromColumn(
  pref: string | null | undefined,
): ContactChoice {
  if (pref == null || pref === '') return 'default';
  if (pref === 'sms' || pref === 'whatsapp') return 'sms';
  if (pref === 'email') return 'email';
  if (pref === 'none') return 'none';
  return 'default';
}

export function contactChoiceToColumn(
  choice: ContactChoice,
): 'sms' | 'email' | 'none' | null {
  if (choice === 'default') return null;
  return choice;
}
