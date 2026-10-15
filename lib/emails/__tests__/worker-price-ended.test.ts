import { describe, expect, it } from 'vitest';
import { buildWorkerPriceEndedEmail } from '@/lib/emails/worker-price-ended';

describe('buildWorkerPriceEndedEmail', () => {
  it('says why, what the new price is, and that nothing else changes', () => {
    const email = buildWorkerPriceEndedEmail({ businessName: 'Sam Locks', employerName: 'Acme Locks' });
    expect(email.subject).toBe('Your Lite price is changing');
    expect(email.text).toContain('because you work with Acme Locks');
    expect(email.text).toContain('£35 a month');
    expect(email.text).toContain('Sam Locks');
    expect(email.html).toContain('Nothing else changes');
  });

  it('copes with an employer that is not known', () => {
    const email = buildWorkerPriceEndedEmail({ businessName: 'Sam Locks', employerName: null });
    expect(email.text).toContain('because you worked with a Pro business');
  });

  it('escapes names and keeps them to one line', () => {
    const email = buildWorkerPriceEndedEmail({ businessName: 'A <b>\nB', employerName: 'X & Y' });
    expect(email.html).toContain('A &lt;b&gt; B');
    expect(email.html).toContain('X &amp; Y');
    expect(email.html).not.toContain('<b>');
  });
});
