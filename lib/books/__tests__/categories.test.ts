import { describe, expect, it } from 'vitest';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_HMRC,
  EXPENSE_CATEGORY_LABELS,
  isExpenseCategory,
} from '@/lib/books/categories';

describe('expense categories', () => {
  it('has the nine fixed keys', () => {
    expect([...EXPENSE_CATEGORIES]).toEqual([
      'vehicle', 'equipment', 'supplies', 'phone', 'insurance',
      'advertising', 'fees', 'wages', 'other',
    ]);
  });

  it('gives every key a label and an HMRC heading', () => {
    for (const key of EXPENSE_CATEGORIES) {
      expect(EXPENSE_CATEGORY_LABELS[key]).toBeTruthy();
      expect(EXPENSE_CATEGORY_HMRC[key]).toBeTruthy();
    }
  });

  it('recognises only the nine keys', () => {
    expect(isExpenseCategory('vehicle')).toBe(true);
    expect(isExpenseCategory('fuel')).toBe(false);
    expect(isExpenseCategory(null)).toBe(false);
    expect(isExpenseCategory(3)).toBe(false);
  });
});
