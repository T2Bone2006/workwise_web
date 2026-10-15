const REQUIREMENT_LABELS: Record<string, string> = {
  'individual.verification.document': 'Photo ID',
  'individual.verification.additional_document': 'Proof of address',
  external_account: 'Bank account for payouts',
  'business_profile.url': 'What your business does',
  'business_profile.product_description': 'What your business does',
};

/** Plain-English label for a Stripe requirement key; unknown keys → 'Other details Stripe needs'. */
export function requirementLabel(key: string): string {
  if (key.startsWith('individual.dob.')) return 'Date of birth';
  if (key.startsWith('individual.address.')) return 'Home address';
  if (key.startsWith('tos_acceptance.')) return "Accept Stripe's terms";
  return REQUIREMENT_LABELS[key] ?? 'Other details Stripe needs';
}
