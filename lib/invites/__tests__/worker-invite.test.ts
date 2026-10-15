import { describe, expect, it } from 'vitest';
import { businessSetupSchema } from '@/lib/validations/business-setup';
import { inviteKindFor, isEmailExistsError, parseInviteKind } from '@/lib/invites/worker-invite';

describe('inviteKindFor', () => {
  it('sends the set-up invite to subcontractors only', () => {
    expect(inviteKindFor('company_subcontractor')).toBe('business');
    expect(inviteKindFor('employee')).toBe('employee');
    expect(inviteKindFor('both')).toBe('employee');
    expect(inviteKindFor('platform_solo')).toBe('employee');
    expect(inviteKindFor(null)).toBe('employee');
    expect(inviteKindFor(undefined)).toBe('employee');
  });
});

describe('parseInviteKind', () => {
  it('treats anything but business as a plain invite, including rows from before the column existed', () => {
    expect(parseInviteKind('business')).toBe('business');
    expect(parseInviteKind('employee')).toBe('employee');
    expect(parseInviteKind(undefined)).toBe('employee');
    expect(parseInviteKind(null)).toBe('employee');
    expect(parseInviteKind('Business')).toBe('employee');
  });
});

describe('isEmailExistsError', () => {
  it('recognises Supabase refusing an address that already has a login', () => {
    expect(isEmailExistsError({ code: 'email_exists' })).toBe(true);
    expect(isEmailExistsError({ code: 'user_already_exists' })).toBe(true);
    expect(isEmailExistsError({ message: 'A user with this email address has already been registered' })).toBe(true);
    expect(isEmailExistsError({ message: 'User already exists' })).toBe(true);
  });
  it('does not mistake other errors for it', () => {
    expect(isEmailExistsError(null)).toBe(false);
    expect(isEmailExistsError({ message: 'Rate limit exceeded' })).toBe(false);
    expect(isEmailExistsError({ code: 'over_email_send_rate_limit' })).toBe(false);
  });
});

describe('businessSetupSchema', () => {
  it('accepts a name and trims it, with the optional fields empty', () => {
    expect(businessSetupSchema.parse({ businessName: '  Sam Subbie Locks ' })).toEqual({
      businessName: 'Sam Subbie Locks',
      trade: '',
      postcode: '',
    });
  });
  it('refuses a missing, one-letter or very long name', () => {
    expect(businessSetupSchema.safeParse({}).success).toBe(false);
    expect(businessSetupSchema.safeParse({ businessName: ' A ' }).success).toBe(false);
    expect(businessSetupSchema.safeParse({ businessName: 'x'.repeat(81) }).success).toBe(false);
  });
});
