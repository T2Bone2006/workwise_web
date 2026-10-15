import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: (...a: unknown[]) => send(...a) } },
  FROM_EMAIL: 'noreply@joinworkwise.com',
}));

import {
  buildRoundsWelcomeEmail,
  roundsSignupGetsWelcome,
  roundsWelcomeIdempotencyKey,
  sendRoundsWelcomeEmail,
} from '@/lib/emails/rounds-welcome';

const APP = 'https://app.joinworkwise.com/download';

describe('rounds welcome email', () => {
  it('thanks them and links to the app', () => {
    const email = buildRoundsWelcomeEmail({ fullName: 'Sarah Jones' });
    expect(email.subject).toBe('Thanks for joining WorkWise');
    expect(email.text).toContain('Hi Sarah,');
    expect(email.text).toContain('Thanks for signing up. Your round runs in the WorkWise app on your phone.');
    expect(email.text).toContain(`Get the app: ${APP}`);
    expect(email.text).toContain('Sign in with this email address.');
    expect(email.html).toContain('Get the WorkWise app');
    expect(email.html).toContain(`href="${APP}"`);
  });

  it('still reads cleanly with no name', () => {
    const email = buildRoundsWelcomeEmail({ fullName: '   ' });
    expect(email.text.startsWith('Hi,')).toBe(true);
    expect(email.html).toContain('Hi,');
  });

  it('escapes the name and keeps a line break out of it', () => {
    const email = buildRoundsWelcomeEmail({ fullName: 'Ann<b>\nSmith' });
    expect(email.html).toContain('Hi Ann&lt;b&gt;,');
    expect(email.html).not.toContain('<b>');
    expect(email.text).toContain('Hi Ann<b>,');
  });

  it('contains no prices', () => {
    const email = buildRoundsWelcomeEmail({ fullName: 'Sarah Jones' });
    expect(email.html + email.text).not.toMatch(/£/);
  });

  it('is for a Rounds signup, including the bundle, and not for Pro or Lite alone', () => {
    expect(roundsSignupGetsWelcome('rounds')).toBe(true);
    expect(roundsSignupGetsWelcome('both')).toBe(true);
    for (const product of ['lite', 'starter', 'growth', 'pro', null, undefined]) {
      expect(roundsSignupGetsWelcome(product)).toBe(false);
    }
  });
});

describe('sending the rounds welcome', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ data: { id: 'e1' }, error: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends from WorkWise, can be replied to, and uses a stable idempotency key', async () => {
    const intentId = '11111111-2222-3333-4444-555555555555';
    expect(await sendRoundsWelcomeEmail({ to: 'sarah@example.com', fullName: 'Sarah Jones', intentId })).toEqual({
      ok: true,
    });
    const [payload, options] = send.mock.calls[0];
    expect(payload.from).toBe('noreply@joinworkwise.com');
    expect(payload.to).toBe('sarah@example.com');
    expect(payload.replyTo).toBe('support@joinworkwise.com');
    expect(payload.subject).toBe('Thanks for joining WorkWise');
    expect(options).toEqual({ idempotencyKey: roundsWelcomeIdempotencyKey(intentId) });
    expect(options.idempotencyKey).toBe(`rounds-welcome-${intentId}`);
  });

  it('returns ok:false on a Resend error and logs only the error name', async () => {
    send.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'bad sarah@example.com' } });
    expect(await sendRoundsWelcomeEmail({ to: 'sarah@example.com', fullName: 'Sarah', intentId: 'intent-1' })).toEqual({
      ok: false,
    });
    const logged = JSON.stringify((console.error as ReturnType<typeof vi.fn>).mock.calls);
    expect(logged).not.toContain('sarah@example.com');
    expect(logged).toContain('validation_error');
  });
});
