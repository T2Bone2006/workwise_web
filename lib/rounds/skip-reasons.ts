export const USER_SKIP_REASONS = [
  'no_access',
  'weather',
  'customer_declined',
  'customer_away',
  'other',
] as const;

export const SYSTEM_SKIP_REASONS = [
  'agreement_paused',
  'agreement_ended',
] as const;

export type SkipReason =
  | (typeof USER_SKIP_REASONS)[number]
  | (typeof SYSTEM_SKIP_REASONS)[number];

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  no_access: 'No access',
  weather: 'Weather',
  customer_declined: 'Customer declined',
  customer_away: 'Customer away',
  other: 'Other',
  agreement_paused: 'Agreement paused',
  agreement_ended: 'Agreement ended',
};
