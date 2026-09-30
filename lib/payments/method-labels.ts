// Pure: safe to import from client components.

export type AnyPaymentMethod =
  | 'cash'
  | 'cheque'
  | 'bank_transfer'
  | 'card'
  | 'direct_debit'
  | 'pay_by_bank'
  | 'other';

const LABELS: Record<AnyPaymentMethod, string> = {
  cash: 'Cash',
  cheque: 'Cheque',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  direct_debit: 'Direct Debit',
  pay_by_bank: 'Pay by Bank',
  other: 'Other',
};

/** Cash, Cheque, Bank transfer, Card, Direct Debit, Pay by Bank; other / unknown / missing → 'Other'. */
export function paymentMethodLabel(method: string | null | undefined): string {
  if (method && Object.prototype.hasOwnProperty.call(LABELS, method)) {
    return LABELS[method as AnyPaymentMethod];
  }
  return LABELS.other;
}

/** The methods a trader may pick on Mark as paid: never Direct Debit or Pay by Bank (GoCardless records those). */
export const HAND_RECORDED_METHODS: readonly AnyPaymentMethod[] = [
  'cash',
  'cheque',
  'bank_transfer',
  'other',
];
