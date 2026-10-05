import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../public/widget.js'),
  'utf8',
);

describe('widget.js static contract', () => {
  it('posts to the chat and lead routes and sends an enquiry, never a booking', () => {
    expect(source).toContain('/api/widget/chat');
    expect(source).toContain('/api/widget/lead');
    expect(source).toContain("We'll text you shortly. By sending you agree to ");
    expect(source).toContain(' contacting you about this job.');
    expect(source).toContain('Leave my details');
    expect(source).toContain('Your details');
    expect(source).toContain('Nothing is booked.');
    expect(source).toContain('wantsBooking: false');
    expect(source).not.toContain('Book it');
    expect(source).not.toContain('Book a free visit');
    expect(source).not.toContain('Free look-and-quote visit');
    expect(source).not.toContain('Price confirmed by ');
    expect(source).not.toContain('Send enquiry');
  });

  it('has no innerHTML assignment except the static typing-dots markup', () => {
    const assignments = source.match(/\.innerHTML\s*=\s*[^;]+/g) ?? [];
    expect(assignments).toEqual(['.innerHTML = "<span></span><span></span><span></span>"']);
    expect(source).not.toMatch(/insertAdjacentHTML|outerHTML|document\.write/);
  });

  it('stores nothing in localStorage or cookies', () => {
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});
