/**
 * Which ad a sign-up came from. The marketing site passes the ad's tags along in the sign-up link;
 * they are saved on the Stripe customer, so tracking needs no database column and can't block a sign-up.
 */

export const AD_TAGS = ['utm_source', 'utm_campaign', 'utm_content'] as const;
export type AdTag = (typeof AD_TAGS)[number];

/** Short slugs only: this comes from a public link and ends up in Stripe metadata. */
const CLEAN_TAG = /^[a-z0-9][a-z0-9_-]{0,49}$/i;

const METADATA_KEY: Record<AdTag, string> = {
  utm_source: 'ad_source',
  utm_campaign: 'ad_campaign',
  utm_content: 'ad_content',
};

/** The Stripe metadata for a sign-up's ad tags. Anything missing or odd is left out. */
export function adMetadata(read: (tag: AdTag) => unknown): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const tag of AD_TAGS) {
    const value = read(tag);
    if (typeof value === 'string' && CLEAN_TAG.test(value)) metadata[METADATA_KEY[tag]] = value;
  }
  return metadata;
}

export type AdSignup = { adContent: string | null; signupIntentId: string | null };
export type AdResult = { ad: string; started: number; paid: number };

/** Sign-ups per ad, most started first. "Paid" means the sign-up finished and the account was set up. */
export function tallyAdSignups(signups: AdSignup[], paidIntentIds: ReadonlySet<string>): AdResult[] {
  const byAd = new Map<string, AdResult>();
  for (const signup of signups) {
    const ad = signup.adContent ?? 'unknown';
    const row = byAd.get(ad) ?? { ad, started: 0, paid: 0 };
    row.started += 1;
    if (signup.signupIntentId && paidIntentIds.has(signup.signupIntentId)) row.paid += 1;
    byAd.set(ad, row);
  }
  return [...byAd.values()].sort((a, b) => b.started - a.started || a.ad.localeCompare(b.ad));
}
