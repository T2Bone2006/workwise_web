// Read-only copy of the marketing site's cookie choice (workwise_site lib/consent.ts).
// The visitor chooses on joinworkwise.com; the choice is a cookie on the whole joinworkwise.com domain, which this app
// can read. The app never shows its own banner: no "granted" cookie means the Pixel never loads here.
// Keep the cookie name and values in step with the site.

/** The Meta Pixel ID is public (it appears in page source), so it lives in code. */
export const META_PIXEL_ID = '1800844387634264';
export const CONSENT_COOKIE = 'ww_consent';

const ROOT_DOMAIN = 'joinworkwise.com';

/** True only on the real domain, so localhost and preview URLs never send events. */
export function pixelAllowedHere() {
  const host = window.location.hostname;
  return host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`);
}

export function hasMarketingConsent() {
  return document.cookie.split('; ').some((c) => c === `${CONSENT_COOKIE}=granted`);
}
