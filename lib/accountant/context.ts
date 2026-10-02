import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import {
  describeLink,
  loadAccountantContext,
  SESSION_COOKIE,
  type AccountantContext,
} from '@/lib/accountant/access';
import { maskEmail } from '@/lib/accountant/mask-email';
import { LINK_TOKEN_RE } from '@/lib/accountant/tokens';
import { createAdminClient } from '@/lib/supabase/admin';

export type AccountantState =
  | { status: 'ok'; ctx: AccountantContext }
  | { status: 'sign_in'; businessName: string; maskedEmail: string }
  | { status: 'not_found' };

/**
 * Who is looking, for a page or route handler. Every page and route calls this
 * itself; a layout does not protect a route handler. The tenant it returns comes
 * only from the invite row the link points to (T8).
 *
 * - ok: a live session for this link
 * - sign_in: a good link, but no valid session: show the code screen
 * - not_found: a bad or removed link: show nothing about it
 */
export const requireAccountant = cache(async (token: string): Promise<AccountantState> => {
  if (!LINK_TOKEN_RE.test(token)) return { status: 'not_found' };
  const admin = createAdminClient();
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;

  const ctx = await loadAccountantContext(admin, { linkToken: token, sessionToken });
  if (ctx) return { status: 'ok', ctx };

  const link = await describeLink(admin, token);
  if (!link) return { status: 'not_found' };
  return { status: 'sign_in', businessName: link.businessName, maskedEmail: maskEmail(link.email) };
});

/** For a data page: a bad or removed link is a 404; no session sends you to the sign-in screen. */
export async function requireAccountantPage(token: string): Promise<AccountantContext> {
  const state = await requireAccountant(token);
  if (state.status === 'not_found') notFound();
  if (state.status === 'sign_in') redirect(`/accountant/${encodeURIComponent(token)}`);
  return state.ctx;
}
