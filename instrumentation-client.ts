import { analytics } from '@heycatch/sdk';
import { hasMarketingConsent, previewMode } from '@/lib/consent';

// HeyCatch analytics. Next runs this file on the client before hydration, so every page is covered.
// It starts switched off and only runs for someone who pressed Accept on the marketing site's cookie banner (the app
// reads that choice from the shared joinworkwise.com cookie; it never shows a banner of its own).
analytics.init({
  projectKey: 'hck_pk_2TVWxNLgbjfVlZOurqdrd8608P_oJMpa',
  optOutCapturingByDefault: true,
  install: {
    framework: 'nextjs',
    frameworkVersion: '16',
    agent: 'claude-code',
  },
});
if (hasMarketingConsent() && !previewMode()) analytics.optInCapturing();
