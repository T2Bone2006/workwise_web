import { ThemeToggle } from '@/components/layout/theme-toggle';

/**
 * Centered layout for auth pages (e.g. login).
 * Animated gradient background (purple/blue), theme toggle, smooth transitions.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="animated-gradient-bg relative flex min-h-screen flex-col items-center justify-center px-4 py-12 transition-colors duration-500">
      <div className="absolute right-4 top-4 z-10 transition-opacity duration-300">
        <ThemeToggle />
      </div>
      <div className="relative z-0 w-full max-w-[400px]">{children}</div>
    </div>
  );
}
