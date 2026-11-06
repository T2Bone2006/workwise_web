// Read-only copy of the marketing site's cookie choice (workwise_site lib/consent.ts).
// The visitor chooses on joinworkwise.com; the choice is a cookie on the whole joinworkwise.com domain, which this app
// can read. The app never shows its own banner: no current "granted" cookie means the Pixel never loads and no visitor
// code is sent from here. An Accept given under the old wording (no version cookie) does not count.
// Keep the cookie names and values in step with the site.

/** The Meta Pixel ID is public (it appears in page source), so it lives in code. */
export const META_PIXEL_ID = '1800844387634264';
export const CONSENT_COOKIE = 'ww_consent';
/** Which wording the choice was made under; see the site's lib/consent.ts. */
export const CONSENT_VERSION_COOKIE = 'ww_consent_v';
export const CONSENT_VERSION = '3';
/** The visitor's random code, set by the marketing site after Accept. */
export const PERSON_COOKIE = 'ww_vid';

const ROOT_DOMAIN = 'joinworkwise.com';

const PREVIEW_PARAM = 'ww_preview';
/** "Don't count this browser": a cookie on the whole joinworkwise.com domain, set here or by the marketing site. */
export const IGNORE_COOKIE = 'ww_ignore';
const IGNORE_PARAM = 'ww_ignore';
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Turn "don't count this browser" on or off. It lasts a year and only ever reduces tracking. */
export function setIgnoreMe(on: boolean) {
  const host = window.location.hostname;
  const domain = host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`) ? `; Domain=.${ROOT_DOMAIN}` : '';
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${IGNORE_COOKIE}=${on ? '1' : ''}; Path=/; Max-Age=${on ? ONE_YEAR : 0}; SameSite=Lax${domain}${secure}`;
}

export function isIgnoringMe(): boolean {
  return typeof document !== 'undefined' && document.cookie.split('; ').includes(`${IGNORE_COOKIE}=1`);
}

/**
 * True when this visit must not be counted or sent to Facebook: this browser is switched to "don't count me"
 * (lasts a year), or the page was opened with ?ww_preview=1 (the "see the ad pages" links on /admin/website; lasts until
 * the tab closes). It only ever reduces tracking. Same switch as the marketing site's lib/consent.ts.
 */
export function previewMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has(IGNORE_PARAM)) setIgnoreMe(params.get(IGNORE_PARAM) !== '0');
    if (isIgnoringMe()) return true;
    if (params.has(PREVIEW_PARAM)) {
      window.sessionStorage.setItem(PREVIEW_PARAM, '1');
      return true;
    }
    return window.sessionStorage.getItem(PREVIEW_PARAM) === '1';
  } catch {
    return false;
  }
}

/** True only on the real domain (and not in a preview tab), so localhost and preview URLs never send events. */
export function pixelAllowedHere() {
  const host = window.location.hostname;
  return (host === ROOT_DOMAIN || host.endsWith(`.${ROOT_DOMAIN}`)) && !previewMode();
}

export function hasMarketingConsent() {
  const cookies = document.cookie.split('; ');
  return cookies.includes(`${CONSENT_COOKIE}=granted`) && cookies.includes(`${CONSENT_VERSION_COOKIE}=${CONSENT_VERSION}`);
}

/** The visitor's random code, only for someone who accepted. The app never makes one; the marketing site does. */
export function readPersonId(): string | null {
  if (!hasMarketingConsent()) return null;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${PERSON_COOKIE}=`));
  const value = match?.slice(PERSON_COOKIE.length + 1);
  return value && /^[a-z0-9-]{8,40}$/i.test(value) ? value : null;
}
