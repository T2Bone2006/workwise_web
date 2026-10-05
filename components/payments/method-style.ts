import { Banknote, CreditCard, Landmark, Receipt, Repeat, Wallet, Zap, type LucideIcon } from 'lucide-react';
import type { Tone } from '@/components/look';

/** The ways money arrives, with one icon and one colour each so a list reads at a glance. */
export const METHODS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'direct_debit', label: 'Direct Debit' },
  { value: 'pay_by_bank', label: 'Pay by Bank' },
  { value: 'other', label: 'Other' },
];

export const METHOD_ICON: Record<string, LucideIcon> = {
  cash: Banknote,
  cheque: Receipt,
  bank_transfer: Landmark,
  card: CreditCard,
  direct_debit: Repeat,
  pay_by_bank: Zap,
  other: Wallet,
};

export const METHOD_TONE: Record<string, Tone> = {
  card: 'indigo',
  direct_debit: 'violet',
  pay_by_bank: 'teal',
  bank_transfer: 'sky',
  cash: 'slate',
  cheque: 'slate',
  other: 'slate',
};

export function methodIcon(method: string): LucideIcon {
  return METHOD_ICON[method] ?? Wallet;
}

export function methodTone(method: string): Tone {
  return METHOD_TONE[method] ?? 'slate';
}

/** "Sun 4 Oct" from a date or timestamp (the day part only). */
export function formatDayLong(value: string): string {
  const day = value.slice(0, 10);
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "4 Oct" from a date or timestamp (the day part only). */
export function formatDayShort(value: string): string {
  const day = value.slice(0, 10);
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
