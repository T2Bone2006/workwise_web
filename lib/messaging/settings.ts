import { normalizeUkPhoneE164 } from '@/lib/utils/phone';
import type { ChannelOrder } from './channel';

export type MessagingSettings = {
  reminders_enabled: boolean;
  reminder_days_before: number;
  money_channel: ChannelOrder;
  change_channel: ChannelOrder;
  chasers_enabled: boolean;
  payment_thanks_enabled: boolean;
  chase_first_days: number;
  chase_second_days: number;
  contact_phone: string | null;
};

export const DEFAULT_MESSAGING_SETTINGS: MessagingSettings = {
  reminders_enabled: true,
  reminder_days_before: 3,
  money_channel: 'email_first',
  change_channel: 'text_first',
  chasers_enabled: true,
  payment_thanks_enabled: true,
  chase_first_days: 7,
  chase_second_days: 21,
  contact_phone: null,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isInteger(n)) return n;
  }
  return null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 1 || value === 'true') return true;
  if (value === false || value === 0 || value === 'false') return false;
  return fallback;
}

function parseChannelOrder(value: unknown, fallback: ChannelOrder): ChannelOrder {
  if (value === 'email_first' || value === 'text_first') return value;
  return fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseContactPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalised = normalizeUkPhoneE164(raw);
  if (normalised == null) return null;
  if (!/^\+44\d{9,10}$/.test(normalised)) return null;
  return normalised;
}

/** Tolerant. `roundsRaw` is settings.rounds, used only for the reminder_days_before fallback. */
export function parseMessagingSettings(
  raw: unknown,
  roundsRaw?: unknown,
): MessagingSettings {
  const source = isPlainObject(raw) ? raw : {};
  const rounds = isPlainObject(roundsRaw) ? roundsRaw : {};

  const rawDays =
    asInteger(source.reminder_days_before) ??
    asInteger(rounds.reminder_days_before);
  const reminder_days_before =
    rawDays == null
      ? DEFAULT_MESSAGING_SETTINGS.reminder_days_before
      : clamp(rawDays, 1, 7);

  const chase_first_days = (() => {
    const n = asInteger(source.chase_first_days);
    if (n == null) return DEFAULT_MESSAGING_SETTINGS.chase_first_days;
    return clamp(n, 3, 30);
  })();

  let chase_second_days =
    asInteger(source.chase_second_days) ??
    DEFAULT_MESSAGING_SETTINGS.chase_second_days;
  if (chase_second_days <= chase_first_days) {
    chase_second_days = chase_first_days + 14;
  }
  chase_second_days = clamp(chase_second_days, chase_first_days + 1, 60);

  return {
    reminders_enabled: asBoolean(
      source.reminders_enabled,
      DEFAULT_MESSAGING_SETTINGS.reminders_enabled,
    ),
    reminder_days_before,
    money_channel: parseChannelOrder(
      source.money_channel,
      DEFAULT_MESSAGING_SETTINGS.money_channel,
    ),
    change_channel: parseChannelOrder(
      source.change_channel,
      DEFAULT_MESSAGING_SETTINGS.change_channel,
    ),
    chasers_enabled: asBoolean(
      source.chasers_enabled,
      DEFAULT_MESSAGING_SETTINGS.chasers_enabled,
    ),
    payment_thanks_enabled: asBoolean(
      source.payment_thanks_enabled,
      DEFAULT_MESSAGING_SETTINGS.payment_thanks_enabled,
    ),
    chase_first_days,
    chase_second_days,
    contact_phone: parseContactPhone(source.contact_phone),
  };
}

/** Write settings.messaging without touching any other key. */
export function withMessagingSettings(
  tenantSettings: unknown,
  messaging: MessagingSettings,
): Record<string, unknown> {
  const current = isPlainObject(tenantSettings) ? { ...tenantSettings } : {};
  return { ...current, messaging };
}
