'use client';

import { useEffect } from 'react';
import { analytics } from '@heycatch/sdk';

/**
 * Tells HeyCatch who is signed in. Mounted once in the dashboard layout, which only renders for a
 * signed-in user. The id is the stable user id, never the email; the email goes in the properties.
 */
export function AnalyticsIdentify({ userId, email }: { userId: string; email?: string }) {
  useEffect(() => {
    analytics.setIdentity(userId, email ? { email } : {});
  }, [userId, email]);
  return null;
}
