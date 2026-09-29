import { describe, expect, it } from 'vitest';
import { customerFieldSchema } from '@/lib/validations/rounds/customer-field';

describe('customerFieldSchema', () => {
  it('accepts a name and rejects one that is too short', () => {
    expect(customerFieldSchema.safeParse({ field: 'name', value: 'Patel' }).success).toBe(true);
    const tooShort = customerFieldSchema.safeParse({ field: 'name', value: 'A' });
    expect(tooShort.success).toBe(false);
    if (!tooShort.success) expect(tooShort.error.issues[0]?.message).toBe('Name is too short');
  });

  it('accepts a phone, including a blank one', () => {
    expect(customerFieldSchema.safeParse({ field: 'phone', value: '07700 900123' }).success).toBe(
      true,
    );
    expect(customerFieldSchema.safeParse({ field: 'phone', value: '' }).success).toBe(true);
  });

  it('accepts an email and rejects a bad one', () => {
    expect(
      customerFieldSchema.safeParse({ field: 'email', value: 'patel@example.com' }).success,
    ).toBe(true);
    expect(customerFieldSchema.safeParse({ field: 'email', value: '' }).success).toBe(true);
    const bad = customerFieldSchema.safeParse({ field: 'email', value: 'not-an-email' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe('Enter a valid email');
  });

  it('accepts a contact choice and rejects whatsapp', () => {
    expect(
      customerFieldSchema.safeParse({ field: 'contact_choice', value: 'sms' }).success,
    ).toBe(true);
    expect(
      customerFieldSchema.safeParse({ field: 'contact_choice', value: 'whatsapp' }).success,
    ).toBe(false);
  });

  it('accepts reminder and chaser switches', () => {
    expect(
      customerFieldSchema.safeParse({ field: 'visit_reminders', value: true }).success,
    ).toBe(true);
    expect(
      customerFieldSchema.safeParse({ field: 'payment_chasers', value: false }).success,
    ).toBe(true);
  });

  it('accepts payment terms', () => {
    expect(
      customerFieldSchema.safeParse({ field: 'payment_terms', value: 'invoice' }).success,
    ).toBe(true);
  });

  it('accepts a house and normalises the postcode', () => {
    const parsed = customerFieldSchema.safeParse({
      field: 'house',
      value: { address: '12 Elm Road', postcode: 'sw1a1aa' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.field === 'house') {
      expect(parsed.data.value.postcode).toBe('SW1A 1AA');
    }
    expect(
      customerFieldSchema.safeParse({
        field: 'house',
        value: { address: '12', postcode: 'SW1A 1AA' },
      }).success,
    ).toBe(false);
  });

  it('accepts notes and access notes', () => {
    expect(customerFieldSchema.safeParse({ field: 'notes', value: 'Dog in the garden' }).success).toBe(
      true,
    );
    expect(customerFieldSchema.safeParse({ field: 'access_notes', value: '' }).success).toBe(true);
  });

  it('rejects an unknown field', () => {
    expect(customerFieldSchema.safeParse({ field: 'nickname', value: 'Pat' }).success).toBe(false);
  });
});
