'use client';

import { useTheme } from 'next-themes';
import { LogOut, Moon, Sun } from 'lucide-react';
import { logout } from '@/lib/actions/auth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * The signed-in user's menu in the new look: theme and sign out (they used to
 * sit in the top bar). The trigger's contents and classes come from the caller.
 */
export function LookUserMenu({
  userEmail,
  viewAsActive = false,
  side = 'top',
  triggerClassName,
  triggerLabel = 'Your account',
  children,
}: {
  userEmail: string | undefined;
  viewAsActive?: boolean;
  side?: 'top' | 'bottom' | 'right';
  triggerClassName?: string;
  triggerLabel?: string;
  children: React.ReactNode;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const handleLogout = async () => {
    if (viewAsActive) {
      await fetch('/api/admin/view-as/stop', { method: 'POST' });
    }
    await logout();
  };

  return (
    <DropdownMenu>
      {/* No asChild: Slot+useId can mismatch SSR vs client under Next 16 / React 19 */}
      <DropdownMenuTrigger
        aria-label={triggerLabel}
        className={cn('focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', triggerClassName)}
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={side} className="min-w-[220px] rounded-xl border-border bg-popover shadow-lg">
        <DropdownMenuLabel className="font-normal">
          <p className="text-xs text-muted-foreground">Signed in as</p>
          <p className="truncate text-sm font-medium text-foreground">{userEmail ?? '—'}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTheme(isDark ? 'light' : 'dark')} className="cursor-pointer">
          {isDark ? <Sun className="mr-2 size-4" /> : <Moon className="mr-2 size-4" />}
          {isDark ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void handleLogout();
          }}
          className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <LogOut className="mr-2 size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
