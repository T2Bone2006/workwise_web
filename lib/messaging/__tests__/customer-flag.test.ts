import { describe, expect, it } from 'vitest';
import {
  asCustomerFlag,
  businessDefaultLabel,
  choiceToFlag,
  flagToChoice,
  resolveCustomerFlag,
} from '@/lib/messaging/customer-flag';

describe('customer message choice', () => {
  it('stores default as null, yes as true, no as false', () => {
    expect(choiceToFlag('default')).toBeNull();
    expect(choiceToFlag('yes')).toBe(true);
    expect(choiceToFlag('no')).toBe(false);
  });

  it('reads null and anything else as the business default', () => {
    expect(flagToChoice(null)).toBe('default');
    expect(flagToChoice(undefined)).toBe('default');
    expect(flagToChoice(true)).toBe('yes');
    expect(flagToChoice(false)).toBe('no');
    expect(asCustomerFlag('true')).toBeNull();
  });

  it('lets an explicit yes or no beat the business default', () => {
    expect(resolveCustomerFlag(null, true)).toBe(true);
    expect(resolveCustomerFlag(null, false)).toBe(false);
    expect(resolveCustomerFlag(undefined, false)).toBe(false);
    expect(resolveCustomerFlag(true, false)).toBe(true);
    expect(resolveCustomerFlag(false, true)).toBe(false);
  });

  it('names the current default in the choice label', () => {
    expect(businessDefaultLabel(true)).toBe('Business default (on)');
    expect(businessDefaultLabel(false)).toBe('Business default (off)');
  });
});
