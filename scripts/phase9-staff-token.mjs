/**
 * Prints a staff member's access token (test accounts only) so the Phase 9 walkthrough can call the staff API with curl.
 *
 *   TEAM_TEST_PASSWORD=… node --env-file=.env.local scripts/phase9-staff-token.mjs you+teamdave@gmail.com
 *
 * The password is read from TEAM_TEST_PASSWORD, never printed. Localhost keys only.
 */
const email = process.argv[2];
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.TEAM_TEST_PASSWORD;

if (!email || !url || !anon || !password) {
  console.error('Usage: TEAM_TEST_PASSWORD=… node --env-file=.env.local scripts/phase9-staff-token.mjs <email>');
  process.exit(1);
}

const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const body = await res.json();
if (!res.ok || !body.access_token) {
  console.error('Sign-in failed:', body.error_description ?? body.msg ?? res.status);
  process.exit(1);
}
console.log(body.access_token);
