import { analytics } from '@heycatch/sdk';

// HeyCatch analytics. Next runs this file on the client before hydration, so every page is covered.
analytics.init({
  projectKey: 'hck_pk_2TVWxNLgbjfVlZOurqdrd8608P_oJMpa',
  install: {
    framework: 'nextjs',
    frameworkVersion: '16',
    agent: 'claude-code',
  },
});
