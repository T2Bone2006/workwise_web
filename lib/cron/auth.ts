import 'server-only';

/**
 * Guards app/api/cron/* routes.
 *
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. A manual run (or
 * pg_cron + pg_net, if the dashboard isn't on Vercel) can send the same value
 * in `x-workwise-cron-secret` instead.
 */
export function isAuthorisedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = request.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) return true;
  return request.headers.get('x-workwise-cron-secret') === secret;
}
