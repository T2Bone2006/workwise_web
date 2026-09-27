import { describe, expect, it } from 'vitest';
import {
  checkoutAmountPence,
  connectStatus,
  mirrorFromStripeAccount,
  type ConnectMirror,
} from '@/lib/payments/connect-status';

const mirror = (
  overrides: Partial<ConnectMirror> = {},
): ConnectMirror => ({
  stripe_connect_charges_enabled: false,
  stripe_connect_payouts_enabled: false,
  stripe_connect_details_submitted: false,
  stripe_connect_requirements_due: [],
  stripe_connect_disabled_reason: null,
  ...overrides,
});

describe('connectStatus', () => {
  it('none when no account', () => {
    expect(connectStatus(false, mirror())).toBe('none');
  });

  it('in_progress when details not submitted', () => {
    expect(connectStatus(true, mirror())).toBe('in_progress');
    expect(connectStatus(true, null)).toBe('in_progress');
  });

  it('active when charges enabled', () => {
    expect(
      connectStatus(
        true,
        mirror({
          stripe_connect_charges_enabled: true,
          stripe_connect_details_submitted: true,
        }),
      ),
    ).toBe('active');
  });

  it('restricted when submitted but charges off or requirements due', () => {
    expect(
      connectStatus(
        true,
        mirror({
          stripe_connect_details_submitted: true,
          stripe_connect_requirements_due: ['individual.verification.document'],
        }),
      ),
    ).toBe('restricted');
  });
});

describe('mirrorFromStripeAccount', () => {
  it('dedupes and sorts requirements_due', () => {
    expect(
      mirrorFromStripeAccount({
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
        requirements: {
          currently_due: ['b', 'a'],
          past_due: ['a', 'c'],
          disabled_reason: 'requirements.past_due',
        },
      }),
    ).toEqual({
      stripe_connect_charges_enabled: true,
      stripe_connect_payouts_enabled: false,
      stripe_connect_details_submitted: true,
      stripe_connect_requirements_due: ['a', 'b', 'c'],
      stripe_connect_disabled_reason: 'requirements.past_due',
    });
  });
});

describe('checkoutAmountPence', () => {
  it('0 → nothing_owed', () => {
    expect(checkoutAmountPence(0)).toEqual({
      ok: false,
      reason: 'nothing_owed',
    });
  });

  it('0.2 → below_minimum', () => {
    expect(checkoutAmountPence(0.2)).toEqual({
      ok: false,
      reason: 'below_minimum',
    });
  });

  it('15 → 1500 pence', () => {
    expect(checkoutAmountPence(15)).toEqual({ ok: true, pence: 1500 });
  });
});
