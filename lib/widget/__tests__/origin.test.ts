import { afterEach, describe, expect, it, vi } from 'vitest';
import { devLocalhostAllowed, hostFromOrigin, isAllowedHost, normaliseWebsite } from '@/lib/widget/origin';

describe('normaliseWebsite', () => {
  it('strips scheme, www, path and port, and lower-cases', () => {
    expect(normaliseWebsite('HTTPS://WWW.Dave.co.uk/')).toBe('dave.co.uk');
    expect(normaliseWebsite('https://www.daveplastering.co.uk/contact')).toBe('daveplastering.co.uk');
    expect(normaliseWebsite('daveplastering.co.uk ')).toBe('daveplastering.co.uk');
  });

  it('keeps a real subdomain and only strips a leading www', () => {
    expect(normaliseWebsite('shop.dave.co.uk')).toBe('shop.dave.co.uk');
    expect(normaliseWebsite('www.shop.dave.co.uk')).toBe('shop.dave.co.uk');
  });

  it('rejects a bare name, localhost and an IP', () => {
    expect(normaliseWebsite('dave')).toBeNull();
    expect(normaliseWebsite('localhost:3000')).toBeNull();
    expect(normaliseWebsite('192.168.1.4')).toBeNull();
    expect(normaliseWebsite('')).toBeNull();
  });
});

describe('hostFromOrigin', () => {
  it('reads the hostname and drops the port and path', () => {
    expect(hostFromOrigin('https://www.Dave.co.uk:443/x')).toBe('www.dave.co.uk');
  });

  it('rejects a missing, unparsable or non-http origin', () => {
    expect(hostFromOrigin(null)).toBeNull();
    expect(hostFromOrigin('')).toBeNull();
    expect(hostFromOrigin('not a url')).toBeNull();
    expect(hostFromOrigin('ftp://dave.co.uk')).toBeNull();
  });
});

describe('isAllowedHost', () => {
  it('allows the website and its www form only', () => {
    expect(isAllowedHost('www.dave.co.uk', ['dave.co.uk'])).toBe(true);
    expect(isAllowedHost('dave.co.uk', ['dave.co.uk'])).toBe(true);
    expect(isAllowedHost('evil-dave.co.uk', ['dave.co.uk'])).toBe(false);
    expect(isAllowedHost('dave.co.uk.evil.com', ['dave.co.uk'])).toBe(false);
    expect(isAllowedHost('shop.dave.co.uk', ['dave.co.uk'])).toBe(false);
  });

  it('is off when no website is set', () => {
    expect(isAllowedHost('dave.co.uk', [])).toBe(false);
    expect(isAllowedHost(null, ['dave.co.uk'])).toBe(false);
  });
});

describe('devLocalhostAllowed', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows localhost on the laptop only when the flag is set', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WIDGET_ALLOW_LOCALHOST', '1');
    expect(devLocalhostAllowed('localhost')).toBe(true);
    expect(devLocalhostAllowed('127.0.0.1')).toBe(true);
    expect(devLocalhostAllowed('dave.co.uk')).toBe(false);
  });

  it('stays off in production even when the flag is set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WIDGET_ALLOW_LOCALHOST', '1');
    expect(devLocalhostAllowed('localhost')).toBe(false);
    expect(devLocalhostAllowed('127.0.0.1')).toBe(false);
  });

  it('stays off when the flag is missing', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('WIDGET_ALLOW_LOCALHOST', '');
    expect(devLocalhostAllowed('localhost')).toBe(false);
  });
});
