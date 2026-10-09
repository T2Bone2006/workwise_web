export type CookieLike = { name: string; value: string };

/**
 * The cookies a Supabase client in middleware should read: the ones the browser sent, with any the
 * session refresh has just set on the response taking over (so a freshly refreshed token wins over the
 * stale one that came in with the request).
 *
 * The role lookup in middleware.ts used to read the response's cookies only. A response has none of the
 * request's cookies, so that client was signed out and every role check quietly found nobody.
 */
export function mergeCookies<T extends CookieLike>(fromRequest: readonly T[], fromResponse: readonly T[]): T[] {
  const refreshed = new Map(fromResponse.map((cookie) => [cookie.name, cookie]));
  return [...fromRequest.filter((cookie) => !refreshed.has(cookie.name)), ...refreshed.values()];
}
