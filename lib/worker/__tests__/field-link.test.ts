import { describe, expect, it } from 'vitest';
import { detectFieldLink, directionsHref, telHref } from '@/lib/worker/field-link';

describe('detectFieldLink', () => {
  it('finds a UK phone number whatever the spacing', () => {
    expect(detectFieldLink('07700 900123')).toEqual({ kind: 'tel', href: 'tel:07700900123' });
    expect(detectFieldLink('+44 7700 900123')).toEqual({ kind: 'tel', href: 'tel:+447700900123' });
    expect(detectFieldLink('(01632) 960-001')).toEqual({ kind: 'tel', href: 'tel:01632960001' });
  });
  it('finds an email and a link', () => {
    expect(detectFieldLink('a@b.co')?.kind).toBe('mailto');
    expect(detectFieldLink('www.example.com/x')).toEqual({ kind: 'url', href: 'https://www.example.com/x' });
    expect(detectFieldLink('https://example.com')?.href).toBe('https://example.com');
  });
  it('does not turn a sentence that contains a number into a link', () => {
    expect(detectFieldLink('Call 07700 900123 after 5')).toBeNull();
    expect(detectFieldLink('Flat 12, 4 High Street')).toBeNull();
    expect(detectFieldLink('')).toBeNull();
  });
});

describe('telHref / directionsHref', () => {
  it('only builds tel links for phone numbers', () => {
    expect(telHref('07700 900123')).toBe('tel:07700900123');
    expect(telHref('not a number')).toBeNull();
    expect(telHref(null)).toBeNull();
  });
  it('builds a maps link from whatever address parts exist', () => {
    expect(directionsHref('1 High St', 'AB1 2CD')).toBe(
      'https://www.google.com/maps/search/?api=1&query=1%20High%20St%2C%20AB1%202CD',
    );
    expect(directionsHref(null, 'AB1 2CD')).toContain('AB1%202CD');
    expect(directionsHref(null, null)).toBeNull();
    expect(directionsHref('  ', '')).toBeNull();
  });
});
