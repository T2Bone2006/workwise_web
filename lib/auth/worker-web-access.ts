/**
 * Workers on the web.
 *
 * Employees (users.role = 'worker') may use the worker area at /worker and the
 * pages they need to get in (invite, password reset, login). Everything else on
 * the website is for the office and is sent back to /worker.
 */

/** Where a worker lands. */
export const WORKER_HOME = '/worker';

/** Paths an employee (users.role === 'worker') may open on the web. */
export const WORKER_ALLOWED_PATHS = [
  '/worker',
  '/accept-invite',
  '/reset-password',
  '/login',
  '/download',
] as const;

function matches(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** True for /worker, /worker/..., and the invite / reset / login / download pages. */
export function isWorkerWebPath(pathname: string): boolean {
  return WORKER_ALLOWED_PATHS.some((path) => matches(pathname, path));
}

/** True for /worker and everything under it. */
export function isWorkerAreaPath(pathname: string): boolean {
  return matches(pathname, WORKER_HOME);
}

/**
 * What the middleware does with a signed-in employee:
 * - 'continue': let the request through (the worker area, invite and reset pages).
 * - 'home': send them to /worker (an office page, or /login while already signed in).
 */
export function employeeRouteDecision(pathname: string): 'continue' | 'home' {
  if (matches(pathname, '/login')) return 'home';
  return isWorkerWebPath(pathname) ? 'continue' : 'home';
}

/** Shown on /login when a link arrives with ?error=worker_app. */
export const WORKER_WEB_LOGIN_ERROR =
  'Worker accounts use the WorkWise mobile app, not the website. Please open the app to sign in.';

export const WORKER_WEB_LOGIN_ERROR_PARAM = 'worker_app';
