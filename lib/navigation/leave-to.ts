'use server';

import { redirect, RedirectType } from 'next/navigation';

/**
 * Leave this page after a save.
 *
 * router.push, router.back and router.refresh in the same turn as a server
 * action get cancelled: the action is still applying its refresh of the page
 * you are on, and that refresh wins, so you stay put even though the save
 * worked. redirect() is part of the following action, so the move happens.
 */
export async function leaveTo(href: string, mode: 'push' | 'replace' = 'replace'): Promise<never> {
  redirect(internalPath(href), mode === 'push' ? RedirectType.push : RedirectType.replace);
}

function internalPath(href: string): string {
  if (typeof href !== 'string' || href.length === 0 || href.length > 2000) {
    return '/dashboard';
  }
  let url: URL;
  try {
    url = new URL(href, 'http://workwise.local');
  } catch {
    return '/dashboard';
  }
  if (url.origin !== 'http://workwise.local' || !url.pathname.startsWith('/')) {
    return '/dashboard';
  }
  return `${url.pathname}${url.search}`;
}
