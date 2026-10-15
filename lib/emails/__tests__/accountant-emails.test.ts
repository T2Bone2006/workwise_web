import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: (...a: unknown[]) => send(...a) } },
  FROM_EMAIL: 'noreply@joinworkwise.com',
}));

import { buildAccountantCodeEmail, sendAccountantCode } from '@/lib/emails/accountant-code';
import { buildAccountantInviteEmail, sendAccountantInvite } from '@/lib/emails/accountant-invite';

const LINK = 'https://app.joinworkwise.com/accountant/' + 'a'.repeat(43);

describe('invite email', () => {
  it('has the exact subject and the wording the card asks for', () => {
    const e = buildAccountantInviteEmail({ businessName: 'Bright Windows', inviterName: 'Sam Smith', link: LINK });
    expect(e.subject).toBe('Bright Windows has given you access to their books');
    for (const part of [
      'Sam Smith uses WorkWise to run their business and has given you read-only access to their books',
      "money in and out, expenses with receipt photos, invoices and payments, and downloads for their tax return",
      "You can't change anything and you won't see their customers' contact details.",
      "Open Bright Windows's books",
      "we'll email you a 6-digit code — no password needed",
      'the link keeps working until Bright Windows removes your access',
      "If you weren't expecting this, you can ignore it.",
    ]) {
      expect(e.text).toContain(part);
    }
    expect(e.text).toContain(LINK);
    expect(e.html).toContain(`href="${LINK}"`);
  });

  it('falls back to the business name when there is no inviter', () => {
    const e = buildAccountantInviteEmail({ businessName: 'Bright Windows', inviterName: null, link: LINK });
    expect(e.text).toContain('Bright Windows uses WorkWise');
    expect(buildAccountantInviteEmail({ businessName: 'Bright Windows', inviterName: '   ', link: LINK }).text)
      .toContain('Bright Windows uses WorkWise');
  });

  it('escapes HTML in names but leaves the plain text alone', () => {
    const e = buildAccountantInviteEmail({
      businessName: `Fish & "Chips" <b>Ltd</b>'s`, inviterName: '<script>alert(1)</script>', link: LINK,
    });
    expect(e.html).not.toContain('<script>');
    expect(e.html).not.toContain('<b>Ltd</b>');
    expect(e.html).toContain('Fish &amp; &quot;Chips&quot; &lt;b&gt;Ltd&lt;/b&gt;');
    expect(e.text).toContain(`Fish & "Chips" <b>Ltd</b>'s`);
  });

  it('keeps a business name with a line break to one line in the subject', () => {
    const e = buildAccountantInviteEmail({ businessName: 'Bright\r\nBcc: x@y.com', inviterName: null, link: LINK });
    expect(e.subject).not.toMatch(/[\r\n]/);
  });

  it('contains no money figures and no customer data', () => {
    const e = buildAccountantInviteEmail({ businessName: 'Bright Windows', inviterName: null, link: LINK });
    expect(e.html + e.text).not.toMatch(/£/);
  });
});

describe('code email', () => {
  it('has the code in the subject and the body, and says it lasts 10 minutes', () => {
    const e = buildAccountantCodeEmail({ businessName: 'Bright Windows', code: '042913' });
    expect(e.subject).toBe("Your code for Bright Windows's books: 042913");
    expect(e.text).toContain('Your code is 042913. It works for 10 minutes.');
    expect(e.text).toContain("If you didn't try to open Bright Windows's books, ignore this email — nobody can get in without the code.");
    expect(e.html).toContain('042913');
    expect(e.html).toContain('It works for 10 minutes.');
  });

  it('escapes the business name in the HTML', () => {
    const e = buildAccountantCodeEmail({ businessName: '<i>X</i> & Co', code: '123456' });
    expect(e.html).toContain('&lt;i&gt;X&lt;/i&gt; &amp; Co');
  });
});

describe('sending', () => {
  const originalUrl = process.env.NEXT_PUBLIC_APP_URL;
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ data: { id: 'e1' }, error: null });
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.joinworkwise.com/';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalUrl;
    vi.restoreAllMocks();
  });

  const token = 'b'.repeat(43);

  it('builds the link from the app URL and sends from the WorkWise address with no reply-to', async () => {
    expect(await sendAccountantInvite({ to: 'acc@x.com', businessName: 'Bright', inviterName: null, linkToken: token }))
      .toEqual({ ok: true });
    const args = send.mock.calls[0][0];
    expect(args.from).toBe('noreply@joinworkwise.com');
    expect(args.to).toBe('acc@x.com');
    expect(args).not.toHaveProperty('replyTo');
    expect(args).not.toHaveProperty('attachments');
    expect(args.text).toContain(`https://app.joinworkwise.com/accountant/${token}`);
  });

  it('does not send a broken link when the app URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(await sendAccountantInvite({ to: 'acc@x.com', businessName: 'Bright', inviterName: null, linkToken: token }))
      .toEqual({ ok: false });
    expect(send).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[sendAccountantInvite] NEXT_PUBLIC_APP_URL not set');
  });

  it('sends the code email too', async () => {
    expect(await sendAccountantCode({ to: 'acc@x.com', businessName: 'Bright', code: '123456' })).toEqual({ ok: true });
    expect(send.mock.calls[0][0].subject).toBe("Your code for Bright's books: 123456");
  });

  it('returns ok:false on a Resend error or a throw, logging only error names', async () => {
    send.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'bad address acc@x.com 123456' } });
    expect(await sendAccountantCode({ to: 'acc@x.com', businessName: 'Bright', code: '123456' })).toEqual({ ok: false });
    send.mockRejectedValueOnce(new Error('network down for acc@x.com'));
    expect(await sendAccountantCode({ to: 'acc@x.com', businessName: 'Bright', code: '123456' })).toEqual({ ok: false });
    send.mockRejectedValueOnce(new TypeError(`failed ${token} acc@x.com`));
    expect(await sendAccountantInvite({ to: 'acc@x.com', businessName: 'Bright', inviterName: null, linkToken: token }))
      .toEqual({ ok: false });
    const logged = JSON.stringify((console.error as ReturnType<typeof vi.fn>).mock.calls);
    for (const secret of ['123456', 'acc@x.com', token]) expect(logged).not.toContain(secret);
  });
});
