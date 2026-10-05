import type { Metadata } from 'next';
import Image from 'next/image';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { NotFoundCard } from '@/components/layout/not-found-card';

export const metadata: Metadata = {
  title: 'Page not found | WorkWise',
};

/** App-wide 404, in the login page's style so it works signed in or out. */
export default function NotFound() {
  return (
    <div className="animated-gradient-bg relative flex min-h-screen flex-col items-center justify-center px-4 py-12 transition-colors duration-500">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <div className="relative z-0 w-full max-w-[440px]">
        <div className="mb-6 flex justify-center">
          <Image
            src="/workwise_logo.png"
            alt="WorkWise"
            width={96}
            height={96}
            className="h-auto w-[96px] object-contain"
            priority
          />
        </div>
        <NotFoundCard />
      </div>
    </div>
  );
}
