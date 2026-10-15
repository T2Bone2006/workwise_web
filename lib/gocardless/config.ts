import 'server-only';

export type GoCardlessEnv = 'sandbox' | 'live';

const ENV_NAMES = [
  'GOCARDLESS_ENVIRONMENT',
  'GOCARDLESS_CLIENT_ID',
  'GOCARDLESS_CLIENT_SECRET',
  'GOCARDLESS_WEBHOOK_SECRET',
  'GOCARDLESS_TOKEN_KEY',
  'GOCARDLESS_REDIRECT_URI',
] as const;

const BASES: Record<GoCardlessEnv, { apiBase: string; connectBase: string; verifyUrl: string }> = {
  sandbox: {
    apiBase: 'https://api-sandbox.gocardless.com',
    connectBase: 'https://connect-sandbox.gocardless.com',
    verifyUrl: 'https://verify-sandbox.gocardless.com',
  },
  live: {
    apiBase: 'https://api.gocardless.com',
    connectBase: 'https://connect.gocardless.com',
    verifyUrl: 'https://verify.gocardless.com',
  },
};

function env(name: (typeof ENV_NAMES)[number]): string {
  return process.env[name]?.trim() ?? '';
}

/** 32 bytes from base64 (`openssl rand -base64 32`), or null. */
function tokenKeyFrom(raw: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

/**
 * Reads the six GOCARDLESS_* env vars (T26). Throws Error('GoCardless is not
 * configured') if any is missing or GOCARDLESS_ENVIRONMENT isn't sandbox|live.
 */
export function goCardlessConfig(): {
  env: GoCardlessEnv;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  tokenKey: Buffer;
  redirectUri: string;
  apiBase: string;
  connectBase: string;
  verifyUrl: string;
} {
  if (ENV_NAMES.some((name) => env(name) === '')) {
    throw new Error('GoCardless is not configured');
  }
  const environment = env('GOCARDLESS_ENVIRONMENT');
  if (environment !== 'sandbox' && environment !== 'live') {
    throw new Error('GoCardless is not configured');
  }
  const tokenKey = tokenKeyFrom(env('GOCARDLESS_TOKEN_KEY'));
  if (!tokenKey) {
    throw new Error('GoCardless is not configured (GOCARDLESS_TOKEN_KEY must be 32 bytes, base64)');
  }
  return {
    env: environment,
    clientId: env('GOCARDLESS_CLIENT_ID'),
    clientSecret: env('GOCARDLESS_CLIENT_SECRET'),
    webhookSecret: env('GOCARDLESS_WEBHOOK_SECRET'),
    tokenKey,
    redirectUri: env('GOCARDLESS_REDIRECT_URI'),
    ...BASES[environment],
  };
}

/** true when all six are present (screens use it to hide Connect GoCardless instead of crashing). */
export function isGoCardlessConfigured(): boolean {
  try {
    goCardlessConfig();
    return true;
  } catch {
    return false;
  }
}
