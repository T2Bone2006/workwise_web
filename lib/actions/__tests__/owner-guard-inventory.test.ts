import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Server actions that use the admin client skip row-level security, so each must check who is calling.
 * A Rounds business now has staff logins in the same business as the owner, so "signed in and in this business"
 * is no longer enough: the caller must be the account owner (or the action must be on the list below with a reason).
 */

const ACTIONS_ROOT = join(process.cwd(), 'lib', 'actions');

const OWNER_GUARDS = [
  'getOwnerTenantId(',
  'requireOwner(',
  'requireAdminRounds(',
  'requireAdminRoundsFor(',
  'requireAdmin(',
  'requireLite(',
  'isTenantAdmin(',
  'gate(',
  "role !== 'admin'",
  "role === 'admin'",
];

const ACTION_ALLOWLIST: Array<{ file: string; reason: string }> = [
  { file: 'auth.ts', reason: 'sign-in, sign-out and password flows: run before or outside an owner session' },
  { file: 'signup.ts', reason: 'self-serve sign-up: there is no business yet' },
  { file: 'pro-signup.ts', reason: 'self-serve Pro sign-up: there is no business yet' },
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...files(full));
    } else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('server action owner guard inventory', () => {
  const candidates = files(ACTIONS_ROOT)
    .map((full) => ({ full, rel: relative(ACTIONS_ROOT, full).split(sep).join('/') }))
    .filter(({ full }) => {
      const text = readFileSync(full, 'utf8');
      return /^['"]use server['"]/m.test(text) && text.includes('createAdminClient');
    });

  it('finds the action files that use the admin client', () => {
    expect(candidates.length).toBeGreaterThan(10);
  });

  it('each one checks the caller is the owner, or is allow-listed with a reason', () => {
    const bad = candidates
      .filter(({ rel }) => !ACTION_ALLOWLIST.some((a) => a.file === rel))
      .filter(({ full }) => {
        const text = readFileSync(full, 'utf8');
        return !OWNER_GUARDS.some((guard) => text.includes(guard));
      })
      .map(({ rel }) => rel);
    expect(
      bad,
      `These server actions use the admin client with no owner check. Use getOwnerTenantId() / requireOwner(), or add them to ACTION_ALLOWLIST with a reason: ${bad.join(', ')}`,
    ).toEqual([]);
  });

  it('actions that read the business without the admin client still do not use the plain tenant helper', () => {
    const plain = files(ACTIONS_ROOT)
      .map((full) => ({ full, rel: relative(ACTIONS_ROOT, full).split(sep).join('/') }))
      .filter(({ rel }) => !rel.startsWith('worker/'))
      .filter(({ full }) => /^['"]use server['"]/m.test(readFileSync(full, 'utf8')))
      .filter(({ full }) => readFileSync(full, 'utf8').includes('getTenantIdForCurrentUser('))
      .map(({ rel }) => rel);
    // These keep their own, stricter owner message (billing, direct debit); everything else uses getOwnerTenantId.
    const allowed = new Set(['billing.ts', 'direct-debit.ts', 'rounds/import.ts', 'rounds/import-after.ts']);
    const bad = plain.filter((rel) => !allowed.has(rel));
    expect(bad, `Use getOwnerTenantId() in: ${bad.join(', ')}`).toEqual([]);
  });
});
