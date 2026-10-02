'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '', label: 'Summary' },
  { href: '/expenses', label: 'Expenses' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/payments', label: 'Payments' },
  { href: '/downloads', label: 'Downloads' },
] as const;

export function AccountantNav({ token }: { token: string }) {
  const pathname = usePathname();
  const base = `/accountant/${token}`;
  return (
    <nav className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-[3px]" aria-label="Sections">
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const active = tab.href === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={tab.label}
            href={href}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
