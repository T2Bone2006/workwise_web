'use client';

import { useSyncExternalStore } from 'react';
import Script from 'next/script';
import { META_PIXEL_ID, hasMarketingConsent, pixelAllowedHere } from '@/lib/consent';

type Fbq = (...args: unknown[]) => void;

/**
 * The Meta Pixel for the sign-up pages only, and only if the visitor pressed Accept on the marketing site's cookie
 * banner (the choice is a cookie shared across joinworkwise.com). No consent, or not on the real domain: renders nothing.
 */
export function MetaPixel() {
  // Reads the cookie in the browser only; the server and the first paint render nothing.
  const load = useSyncExternalStore(
    () => () => {},
    () => pixelAllowedHere() && hasMarketingConsent(),
    () => false,
  );

  if (!load) return null;

  return (
    <Script id="meta-pixel" strategy="afterInteractive">{`
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');
`}</Script>
  );
}

/**
 * Tells Meta a standard event happened (e.g. "CompleteRegistration"), once per browser tab session.
 * Does nothing without consent. Waits a few seconds for the Pixel script to arrive.
 */
export function trackMetaEvent(event: string) {
  if (typeof window === 'undefined' || !pixelAllowedHere() || !hasMarketingConsent()) return;
  const key = `ww_meta_${event}`;
  if (window.sessionStorage.getItem(key)) return;

  let tries = 0;
  const attempt = () => {
    const fbq = (window as unknown as { fbq?: Fbq }).fbq;
    if (fbq) {
      fbq('track', event);
      window.sessionStorage.setItem(key, '1');
      return;
    }
    if (++tries < 20) window.setTimeout(attempt, 250);
  };
  attempt();
}
