import { ThemeToggle } from '@/components/layout/theme-toggle';

/**
 * Pages built on `AuthShell` fill the screen themselves; any page still using
 * a bare card is centred on the warm canvas with its own theme toggle.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="group/auth relative flex min-h-dvh flex-col items-center justify-center bg-[#F7F7F4] px-4 py-12 dark:bg-[#070F1B] has-[.auth-shell]:block has-[.auth-shell]:p-0 lg:has-[.auth-shell]:h-dvh lg:has-[.auth-shell]:overflow-hidden">
      <div className="absolute right-4 top-4 z-10 group-has-[.auth-shell]/auth:hidden">
        <ThemeToggle />
      </div>
      <div className="relative z-0 w-full max-w-[400px] group-has-[.auth-shell]/auth:max-w-none">
        {children}
      </div>
    </div>
  );
}
