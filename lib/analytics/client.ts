// Browser side of the cookie-free sign-up step counting (the marketing site has its own copy of this in
// workwise_site lib/track.ts). Nothing is stored in the browser: the visit code below is held in memory only,
// so it joins one sign-up page's steps together and is gone when the page closes.

const ROOT_DOMAIN = 'joinworkwise.com';

type NavigatorWithPrivacy = Navigator & { globalPrivacyControl?: boolean };

let visit: string | null = null;

function visitId(): string {
  if (!visit) {
    visit =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
  return visit;
}

function allowedHere(): boolean {
  const host = window.location.hostname;
  if (host !== ROOT_DOMAIN && !host.endsWith(`.${ROOT_DOMAIN}`)) return false;
  const nav = navigator as NavigatorWithPrivacy;
  return nav.doNotTrack !== '1' && nav.globalPrivacyControl !== true;
}

/** Counts a sign-up step: 'plan', 'details' or 'submitted'. Never throws and never slows the page. */
export function trackSignupStep(step: 'plan' | 'details' | 'submitted'): void {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const body = JSON.stringify({
    visit: visitId(),
    kind: 'signup',
    page: window.location.pathname,
    detail: step,
    ad_source: params.get('utm_source') || undefined,
    ad_content: params.get('utm_content') || undefined,
  });

  if (process.env.NODE_ENV !== 'production') {
    console.debug('[track]', JSON.parse(body));
    return;
  }
  if (!allowedHere()) return;

  try {
    if (navigator.sendBeacon?.('/api/public/track', new Blob([body], { type: 'text/plain' }))) return;
    void fetch('/api/public/track', { method: 'POST', body, keepalive: true }).catch(() => {});
  } catch {
    // Counting must never get in the way of signing up.
  }
}
