'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useLayoutEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';

type Crumb = { label: string; href?: string; nameId?: string };

const BreadcrumbNamesContext = createContext<{
  names: Record<string, string>;
  setName: (id: string, name: string | null) => void;
} | null>(null);

export function BreadcrumbNamesProvider({ children }: { children: React.ReactNode }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const setName = useCallback((id: string, name: string | null) => {
    setNames((prev) => {
      if (name == null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (prev[id] === name) return prev;
      return { ...prev, [id]: name };
    });
  }, []);
  return (
    <BreadcrumbNamesContext.Provider value={{ names, setName }}>
      {children}
    </BreadcrumbNamesContext.Provider>
  );
}

/** Tell the trail the real name for a dynamic page, such as a customer. */
export function SetBreadcrumbName({ id, name }: { id: string; name: string }) {
  const setName = useContext(BreadcrumbNamesContext)?.setName;
  useLayoutEffect(() => {
    if (!setName) return;
    setName(id, name);
    return () => setName(id, null);
  }, [setName, id, name]);
  return null;
}

const SECTION: Record<string, string> = {
  dashboard: 'Dashboard',
  customers: 'Customers',
  calendar: 'Calendar',
  services: 'Services',
  payments: 'Payments',
  bank: 'Bank',
  messages: 'Messages',
  expenses: 'Expenses',
  settings: 'Settings',
  import: 'Import',
  jobs: 'Jobs',
  workers: 'Workers',
  network: 'Network',
  monitor: 'Monitor',
  lite: 'Leads',
  admin: 'Admin',
  rounds: 'Round',
};

function isId(segment: string): boolean {
  return !SECTION[segment] && !['new', 'edit', 'agreements', 'invoices', 'direct-debits', 'texts-bought', 'by-customer', 'conversations', 'widget', 'review', 'view-as', 'ai-analytics', 'seed', 'dev'].includes(segment);
}

/** Path through the app for the current URL. The last crumb is the page you are on. */
export function crumbsForPath(pathname: string): Crumb[] {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return [];

  const [root, a, b, c, d] = parts;
  const section = SECTION[root];
  if (!section) return [{ label: root }];

  const home: Crumb = { label: section, href: `/${root}` };

  if (root === 'customers') {
    if (!a) return [{ label: section }];
    if (a === 'new') return [home, { label: 'Add customer' }];
    if (!isId(a)) return [home, { label: a }];
    const customer: Crumb = { label: 'Customer', href: `/customers/${a}`, nameId: a };
    if (!b) return [home, { label: 'Customer', nameId: a }];
    if (b === 'edit') return [home, customer, { label: 'Edit' }];
    if (b === 'agreements' && c === 'new') return [home, customer, { label: 'Add agreement' }];
    if (b === 'agreements' && c && d === 'edit') return [home, customer, { label: 'Edit agreement' }];
    return [home, customer];
  }

  if (root === 'jobs') {
    if (!a) return [{ label: section }];
    if (a === 'new') return [home, { label: 'New job' }];
    if (a === 'review') return [home, { label: 'Review' }];
    return [home, { label: 'Job' }];
  }

  if (root === 'workers') {
    if (!a) return [{ label: section }];
    if (a === 'new') return [home, { label: 'Add worker' }];
    const worker: Crumb = { label: 'Worker', href: `/workers/${a}` };
    if (b === 'edit') return [home, worker, { label: 'Edit' }];
    return [home, { label: 'Worker' }];
  }

  if (root === 'payments') {
    if (a === 'direct-debits') return [home, { label: 'Existing Direct Debits' }];
    if (a === 'invoices' && b) {
      return [home, { label: 'Invoices', href: '/payments?tab=invoices' }, { label: 'Invoice' }];
    }
    return [{ label: section }];
  }

  if (root === 'messages') {
    if (!a) return [{ label: section }];
    if (a === 'texts-bought') return [home, { label: 'Texts' }];
    if (a === 'by-customer') return [home, { label: 'Customer' }];
    return [home, { label: 'Conversation' }];
  }

  if (root === 'lite') {
    if (a === 'conversations') return [home, { label: 'Conversations' }];
    if (a === 'widget') return [home, { label: 'Widget' }];
    return [{ label: section }];
  }

  if (root === 'admin') {
    if (a === 'view-as') return [home, { label: 'View as' }];
    if (a === 'ai-analytics') return [home, { label: 'AI analytics' }];
    return [{ label: section }];
  }

  if (parts.length === 1) return [{ label: section }];
  return [home, { label: parts.slice(1).join(' / ') }];
}

export function PageBreadcrumb() {
  const pathname = usePathname();
  const names = useContext(BreadcrumbNamesContext)?.names ?? {};
  const crumbs = crumbsForPath(pathname);
  if (crumbs.length < 2) return null;

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          const label = (crumb.nameId && names[crumb.nameId]) || crumb.label;
          return (
            <li key={`${crumb.href ?? crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? (
                <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
              ) : null}
              {last || !crumb.href ? (
                <span
                  className={last ? 'font-medium text-foreground' : undefined}
                  aria-current={last ? 'page' : undefined}
                >
                  {label}
                </span>
              ) : (
                <Link href={crumb.href} className="hover:text-foreground">
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
