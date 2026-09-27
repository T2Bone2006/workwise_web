export type PaymentTerms = 'on_the_day' | 'invoice';

/** 'invoice' and legacy 'monthly_invoice' → true. */
export function sendsInvoice(terms: string | null | undefined): boolean {
  return terms === 'invoice' || terms === 'monthly_invoice';
}

export function termsFromSendsInvoice(send: boolean): PaymentTerms {
  return send ? 'invoice' : 'on_the_day';
}
