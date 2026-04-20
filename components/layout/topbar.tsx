'use client';

import { Menu, LogOut } from 'lucide-react';
import { logout } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface TopbarProps {
  tenantName: string;
  userEmail: string | undefined;
  onMenuClick: () => void;
}

function getInitials(email: string | undefined): string {
  if (!email) return '?';
  const part = email.split('@')[0];
  if (part.length >= 2) return part.slice(0, 2).toUpperCase();
  return part.slice(0, 1).toUpperCase();
}

export function Topbar({ tenantName, userEmail, onMenuClick }: TopbarProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4 transition-all duration-300',
        'border-border/80 bg-background/80 backdrop-blur-[var(--blur-glass)]',
        'dark:border-white/[0.06] dark:bg-background/70',
        'shadow-[0_1px_0_0_var(--glass-border)] dark:shadow-[0_1px_0_0_rgba(255,255,255,0.04)]'
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden size-9 shrink-0 rounded-lg"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </Button>
        <span className="truncate text-sm font-semibold text-foreground">
          {tenantName}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle className="rounded-lg" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-full focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="User menu"
            >
              <Avatar size="default" className="size-8">
                <AvatarFallback className="bg-primary/20 text-primary text-xs font-medium">
                  {getInitials(userEmail)}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-[200px] rounded-xl border-border bg-popover shadow-lg dark:bg-popover"
          >
            <DropdownMenuLabel className="font-normal">
              <p className="text-xs text-muted-foreground">Signed in as</p>
              <p className="truncate text-sm font-medium text-foreground">
                {userEmail ?? '—'}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <form
              action={async (formData) => {
                await logout(undefined, formData);
              }}
            >
              <DropdownMenuItem asChild>
                <button
                  type="submit"
                  className="w-full cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive dark:focus:bg-destructive/20"
                >
                  <LogOut className="mr-2 size-4" />
                  Log out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
