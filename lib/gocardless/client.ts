import 'server-only';

import { goCardlessConfig } from '@/lib/gocardless/config';

const API_VERSION = '2015-07-06';
const TIMEOUT_MS = 20_000;
const MAX_RATE_LIMIT_WAIT_MS = 5_000;
const PAGE_LIMIT = 500;

/** Never carries the token or the request body — only what GoCardless said. */
export class GoCardlessError extends Error {
  status: number;
  type: string | null;
  code: number | null;
  reasons: string[];
  conflictingResourceId: string | null;
  requestId: string | null;

  constructor(p: {
    message: string;
    status: number;
    type?: string | null;
    code?: number | null;
    reasons?: string[];
    conflictingResourceId?: string | null;
    requestId?: string | null;
  }) {
    super(p.message);
    this.name = 'GoCardlessError';
    this.status = p.status;
    this.type = p.type ?? null;
    this.code = p.code ?? null;
    this.reasons = p.reasons ?? [];
    this.conflictingResourceId = p.conflictingResourceId ?? null;
    this.requestId = p.requestId ?? null;
  }
}

export type GoCardlessClient = {
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  post<T>(path: string, body: Record<string, unknown>, opts: { idempotencyKey: string }): Promise<T>;
  /** Actions (e.g. /mandates/MD123/actions/cancel): POST with { data: {} } unless body given; idempotency key optional. */
  action<T>(path: string, body?: Record<string, unknown>): Promise<T>;
  /** Follows cursor pagination (meta.cursors.after) up to maxPages (default 20, 500 per page); returns the resource array. */
  listAll<T>(path: string, key: string, query?: Record<string, string>, maxPages?: number): Promise<T[]>;
};

const REVOKED_REASONS = new Set([
  'access_token_revoked',
  'access_token_not_active',
  'access_token_not_found',
]);

/** true for 401 access_token_revoked / access_token_not_active / access_token_not_found. */
export function isRevokedError(err: unknown): boolean {
  return (
    err instanceof GoCardlessError &&
    err.status === 401 &&
    err.reasons.some((reason) => REVOKED_REASONS.has(reason))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function errorFromResponse(status: number, json: unknown): GoCardlessError {
  const error = isRecord(json) && isRecord(json.error) ? json.error : {};
  const items = Array.isArray(error.errors) ? error.errors.filter(isRecord) : [];
  const reasons = items
    .map((item) => str(item.reason))
    .filter((reason): reason is string => reason != null);
  let conflictingResourceId = isRecord(error.links)
    ? str(error.links.conflicting_resource_id)
    : null;
  for (const item of items) {
    if (conflictingResourceId) break;
    if (isRecord(item.links)) conflictingResourceId = str(item.links.conflicting_resource_id);
  }
  return new GoCardlessError({
    message: str(error.message) ?? `GoCardless request failed (${status})`,
    status,
    type: str(error.type),
    code: typeof error.code === 'number' ? error.code : null,
    reasons,
    conflictingResourceId,
    requestId: str(error.request_id),
  });
}

/** RateLimit-Reset is an HTTP date; accept seconds too. Capped at 5 s. */
function rateLimitWaitMs(header: string | null, now: number): number {
  if (!header) return 1_000;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(header) - now;
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(ms, MAX_RATE_LIMIT_WAIT_MS);
}

function buildUrl(
  apiBase: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  if (!path.startsWith('/')) {
    throw new Error('GoCardless path must start with /');
  }
  const url = new URL(`${apiBase}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** A client acting as one business (Authorization: Bearer <decrypted token>). */
export function goCardlessClient(accessToken: string): GoCardlessClient {
  const { apiBase } = goCardlessConfig();

  async function request<T>(
    method: 'GET' | 'POST',
    url: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string,
    retried = false,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'GoCardless-Version': API_VERSION,
      Accept: 'application/json',
    };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch (err) {
      const timedOut =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new GoCardlessError({
        message: timedOut ? 'GoCardless took too long to answer' : 'Could not reach GoCardless',
        status: 0,
      });
    }

    if (res.status === 429 && !retried) {
      const wait = rateLimitWaitMs(res.headers.get('ratelimit-reset'), Date.now());
      await new Promise((resolve) => setTimeout(resolve, wait));
      return request<T>(method, url, body, idempotencyKey, true);
    }

    const text = await res.text().catch(() => '');
    let json: unknown = {};
    if (text !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        json = {};
      }
    }
    if (!res.ok) throw errorFromResponse(res.status, json);
    return json as T;
  }

  return {
    get<T>(path: string, query?: Record<string, string | number | undefined>) {
      return request<T>('GET', buildUrl(apiBase, path, query));
    },
    post<T>(path: string, body: Record<string, unknown>, opts: { idempotencyKey: string }) {
      if (!opts?.idempotencyKey) {
        throw new Error('GoCardless POST needs an idempotency key');
      }
      return request<T>('POST', buildUrl(apiBase, path), body, opts.idempotencyKey);
    },
    action<T>(path: string, body?: Record<string, unknown>) {
      return request<T>('POST', buildUrl(apiBase, path), body ?? { data: {} });
    },
    async listAll<T>(
      path: string,
      key: string,
      query?: Record<string, string>,
      maxPages = 20,
    ): Promise<T[]> {
      const out: T[] = [];
      let after: string | undefined;
      for (let page = 0; page < maxPages; page++) {
        const json = await request<Record<string, unknown>>(
          'GET',
          buildUrl(apiBase, path, { ...query, limit: PAGE_LIMIT, after }),
        );
        const items = json[key];
        if (Array.isArray(items)) out.push(...(items as T[]));
        const meta = isRecord(json.meta) ? json.meta : {};
        const cursors = isRecord(meta.cursors) ? meta.cursors : {};
        const next = str(cursors.after);
        if (!next) break;
        after = next;
      }
      return out;
    },
  };
}
