import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Default deny for the API. A Rounds business now has more than one login (the owner and their staff), and a
 * staff login resolves to the same business as the owner. So every route must either check that the caller is
 * the owner, be a staff route (guarded by requireStaffApi), or be on the explicit list below with the reason it is
 * safe for anyone. A new route that is none of these fails this test.
 */

const API_ROOT = join(process.cwd(), 'app', 'api');

/** Calls a guard that only lets the account owner (users.role = 'admin') through. */
const OWNER_GUARDS = [
  'requireRoundsApi(',
  'requireExpensesApi(',
  'requireDirectDebitApi(',
  'requireAdminRounds(',
  'requireAssistantCaller(',
  'requireLite(',
  'getOwnerTenantId(',
  'requireOwner(',
  'isTenantAdmin(',
];
/** Guards that only let a Rounds member of staff through (the staff API; added in step 13). */
const STAFF_GUARDS = ['requireStaffApi('];

/** Routes that are meant for people who are not signed in as the owner. Each needs a reason. */
const OPEN_BY_DESIGN: Array<{ path: string; reason: string }> = [
  { path: 'accountant/', reason: "the accountant's own emailed-code sign-in; no Supabase user" },
  { path: 'address-autocomplete', reason: 'address lookup; returns no business data' },
  { path: 'address-details', reason: 'address lookup; returns no business data' },
  { path: 'admin/view-as/', reason: 'platform admin impersonation; has its own platform-admin check' },
  { path: 'cron/', reason: 'secret-protected cron routes (isAuthorisedCronRequest)' },
  { path: 'customer-invite/', reason: 'customer portal invite token' },
  { path: 'detect-skills', reason: 'text classifier; returns no business data' },
  { path: 'gocardless/callback', reason: 'OAuth return; the state hash finds the business' },
  { path: 'gocardless/webhook', reason: 'signed webhook' },
  { path: 'hooks/job-outcome', reason: 'signed webhook for Pro job outcomes' },
  { path: 'invite/', reason: 'worker invite token' },
  { path: 'messaging/webhook', reason: 'signed webhook' },
  { path: 'password-reset/', reason: 'reset token' },
  { path: 'pay/', reason: 'public customer pay pages; token based' },
  { path: 'public/', reason: 'public marketing numbers' },
  { path: 'signup/status', reason: 'a sign-up that is still being provisioned (no business yet)' },
  { path: 'stripe/checkout', reason: 'resumes a pending sign-up (no business yet)' },
  { path: 'stripe/connect-webhook', reason: 'signed webhook' },
  { path: 'stripe/webhook', reason: 'signed webhook' },
  { path: 'widget/', reason: 'the public Lite widget on the trader’s website' },
];

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (name === 'route.ts') out.push(full);
  }
  return out;
}

const files = routeFiles(API_ROOT).map((full) => ({
  full,
  rel: relative(API_ROOT, full).split(sep).join('/'),
}));

function source(full: string): string {
  return readFileSync(full, 'utf8');
}

describe('API route inventory (default deny)', () => {
  it('finds the routes', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('every Rounds route calls an owner guard or a staff guard', () => {
    const bad = files
      .filter((f) => f.rel.startsWith('rounds/'))
      .filter((f) => ![...OWNER_GUARDS, ...STAFF_GUARDS].some((g) => source(f.full).includes(g)))
      .map((f) => f.rel);
    expect(bad, `These Rounds routes have no owner or staff guard: ${bad.join(', ')}`).toEqual([]);
  });

  it('every staff route calls requireStaffApi and no owner guard', () => {
    const staff = files.filter((f) => f.rel.startsWith('staff/'));
    const bad = staff
      .filter((f) => {
        const text = source(f.full);
        return !text.includes('requireStaffApi(') || OWNER_GUARDS.some((g) => g !== 'isTenantAdmin(' && text.includes(g));
      })
      .map((f) => f.rel);
    expect(bad, `Staff routes must use requireStaffApi only: ${bad.join(', ')}`).toEqual([]);
  });

  it('every other route is owner-guarded or on the open-by-design list', () => {
    const bad = files
      .filter((f) => !f.rel.startsWith('rounds/') && !f.rel.startsWith('staff/'))
      .filter((f) => !OPEN_BY_DESIGN.some((o) => f.rel === o.path || f.rel.startsWith(o.path)))
      .filter((f) => !OWNER_GUARDS.some((g) => source(f.full).includes(g)))
      .map((f) => f.rel);
    expect(
      bad,
      `Add an owner guard to these routes, or add them to OPEN_BY_DESIGN with a reason: ${bad.join(', ')}`,
    ).toEqual([]);
  });

  it('no route on the open list quietly reads the signed-in business without a guard', () => {
    const risky = files
      .filter((f) => OPEN_BY_DESIGN.some((o) => f.rel === o.path || f.rel.startsWith(o.path)))
      .filter((f) => source(f.full).includes('getTenantIdForCurrentUser('))
      .map((f) => f.rel);
    expect(risky, `Open routes must not use getTenantIdForCurrentUser: ${risky.join(', ')}`).toEqual([]);
  });

  it('nothing under rounds/ reads the tenant without going through a guard', () => {
    const risky = files
      .filter((f) => f.rel.startsWith('rounds/'))
      .filter((f) => source(f.full).includes('createClientFromBearer('))
      .map((f) => f.rel);
    expect(risky, `Rounds routes must use requireRoundsApi, not createClientFromBearer: ${risky.join(', ')}`).toEqual([]);
  });
});
