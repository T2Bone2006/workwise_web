import { describe, expect, it } from 'vitest';
import { buildWorkerBusinessInviteEmail } from '@/lib/emails/worker-business-invite';

describe('buildWorkerBusinessInviteEmail', () => {
  const email = buildWorkerBusinessInviteEmail({
    workerName: 'Sam <b>',
    inviteUrl: 'https://app.joinworkwise.com/accept-invite?token=abc',
    tenantName: 'Acme & Sons',
  });

  it('names the employer in the subject and asks for the business set-up', () => {
    expect(email.subject).toBe('Acme & Sons has invited you to WorkWise');
    expect(email.html).toContain('Set up my account');
    expect(email.html).toContain('tell us your business name');
    expect(email.html).toContain('This link works for 7 days');
  });

  it('puts the invite link in the button and as plain text', () => {
    expect(email.html.match(/accept-invite\?token=abc/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('escapes names so they cannot inject markup', () => {
    expect(email.html).not.toContain('Sam <b>');
    expect(email.html).toContain('Sam &lt;b&gt;');
    expect(email.html).toContain('Acme &amp; Sons');
  });
});
