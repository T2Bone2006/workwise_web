import type { MessageKind } from '@/lib/messaging/channel';

/**
 * Leaf module: imports nothing from send.ts, notify.ts or visit-transitions.ts (they import
 * each other, and module-level constants read at load time must come from a leaf).
 */

/** Grace texts a business gets each month for pay-link style messages once everything else is used. WorkWise pays. */
export const GRACE_TEXTS_PER_MONTH = 30;

/** How long a money message waits for texts before it is dropped and listed. */
export const MONEY_WAIT_DAYS = 14;

/** How long a short-life message (reminder, change notice, thank-you) waits. */
export const SHORT_LIFE_WAIT_HOURS = 24;

/** Messages a customer must not miss: they carry a pay link or tell the customer to pay. */
export const MONEY_KINDS: ReadonlySet<MessageKind> = new Set<MessageKind>([
  'visit_done',
  'chaser',
  'dd_invite',
  'dd_failed',
]);

export function isMoneyKind(kind: MessageKind): boolean {
  return MONEY_KINDS.has(kind);
}

/** When a parked message of this kind stops being worth sending. */
export function waitingExpiry(kind: MessageKind, from: Date): Date {
  const ms = isMoneyKind(kind)
    ? MONEY_WAIT_DAYS * 24 * 60 * 60 * 1000
    : SHORT_LIFE_WAIT_HOURS * 60 * 60 * 1000;
  return new Date(from.getTime() + ms);
}
