// No 'server-only': the phone copies these labels (Phase 5 step 26).

export const EXPENSE_CATEGORIES = [
  'vehicle',
  'equipment',
  'supplies',
  'phone',
  'insurance',
  'advertising',
  'fees',
  'wages',
  'other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  vehicle: 'Vehicle & fuel',
  equipment: 'Equipment & tools',
  supplies: 'Cleaning supplies',
  phone: 'Phone & internet',
  insurance: 'Insurance',
  advertising: 'Advertising',
  fees: 'Bank & payment fees',
  wages: 'Wages & subcontractors',
  other: 'Other',
};

/** Printed in the CSV "HMRC heading" column (D10). The accountant may reclassify. */
export const EXPENSE_CATEGORY_HMRC: Record<ExpenseCategory, string> = {
  vehicle: 'Car, van and travel expenses',
  equipment: 'Other allowable business expenses',
  supplies: 'Cost of goods bought for resale or goods used',
  phone: 'Phone, fax, stationery and other office costs',
  insurance: 'Rent, rates, power and insurance costs',
  advertising: 'Advertising and business entertainment costs',
  fees: 'Bank, credit card and other financial charges',
  wages: 'Wages, salaries and other staff costs',
  other: 'Other allowable business expenses',
};

export function isExpenseCategory(v: unknown): v is ExpenseCategory {
  return typeof v === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(v);
}
