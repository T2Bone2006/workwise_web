import { describe, expect, it } from 'vitest';
import { buildWorkerSignInEmailChangedEmail } from '@/lib/emails/worker-sign-in-email-changed';

describe('buildWorkerSignInEmailChangedEmail', () => {
  const email = buildWorkerSignInEmailChangedEmail({
    workerName: 'Saul <b>',
    tenantName: 'RS & Co',
    email: 'info@loxuk.com',
  });

  it('tells them the new sign-in address and that the password is unchanged', () => {
    expect(email.subject).toBe('Your WorkWise sign-in email has changed');
    expect(email.html).toContain('info@loxuk.com');
    expect(email.html).toContain('Your password has not changed.');
  });

  it('escapes the name and the business', () => {
    expect(email.html).not.toContain('Saul <b>');
    expect(email.html).toContain('Saul &lt;b&gt;');
    expect(email.html).toContain('RS &amp; Co');
  });
});
