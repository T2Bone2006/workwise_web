/** 'https://www.Dave.co.uk:443/x' → 'www.dave.co.uk'; anything unparsable or not http(s) → null. */
export function hostFromOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function isIpHost(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(':');
}

/**
 * What a tradie typed ('https://www.daveplastering.co.uk/contact', 'daveplastering.co.uk ')
 * → 'daveplastering.co.uk'. Strips scheme, path, port and one leading 'www.'.
 * Null if it is not a hostname with a dot, or it is localhost or an IP.
 */
export function normaliseWebsite(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let host: string;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    host = url.hostname.toLowerCase();
  } catch {
    return null;
  }

  if (!host) return null;
  if (host.startsWith('www.')) host = host.slice(4);
  if (!host.includes('.')) return null;
  if (host === 'localhost' || isIpHost(host)) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  return host;
}

/** host equals d or 'www.' + d for some d in allowed. Empty allowed → false (D2). */
export function isAllowedHost(host: string | null, allowed: readonly string[]): boolean {
  if (!host || allowed.length === 0) return false;
  const h = host.toLowerCase();
  return allowed.some((raw) => {
    const domain = raw.trim().toLowerCase();
    if (!domain) return false;
    return h === domain || h === `www.${domain}`;
  });
}

/**
 * Laptop testing only: true when host is 'localhost' or '127.0.0.1' AND
 * NODE_ENV is not production AND WIDGET_ALLOW_LOCALHOST is '1'.
 * Always false in production, whatever the env says.
 */
export function devLocalhostAllowed(host: string | null): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.WIDGET_ALLOW_LOCALHOST !== '1') return false;
  return host === 'localhost' || host === '127.0.0.1';
}
