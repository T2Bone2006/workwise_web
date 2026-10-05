'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, Home, LinkIcon, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * The 404 card. "Take me home" goes to `/`, which already sends each person to
 * the right place: the dashboard, the customer portal or the login page.
 */
export function NotFoundCard() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <Card className="glass-card border-white/10 backdrop-blur-xl transition-all duration-300 dark:border-white/[0.06] dark:backdrop-blur-2xl">
      <CardContent className="space-y-6">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">
            <SearchX className="size-6" aria-hidden />
          </span>
          <p className="mt-4 font-mono text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            404 · Page not found
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            We can&apos;t find that page
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            It may have moved, or the address has a typo. Nothing in your account has changed.
          </p>
        </div>

        <div className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-muted/40 px-3 py-2.5">
          <LinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-muted-foreground line-through decoration-rose-500/60">
            {pathname}
          </span>
          <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
            Not found
          </span>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Button asChild size="lg" className="sm:flex-1">
            <Link href="/">
              <Home />
              Take me home
            </Link>
          </Button>
          <Button variant="outline" size="lg" className="sm:flex-1" onClick={() => router.back()}>
            <ArrowLeft />
            Go back
          </Button>
        </div>

        <p className="border-t border-border/60 pt-4 text-center text-xs leading-relaxed text-muted-foreground">
          Came here from a link in a text or email? Ask whoever sent it for a new one.
          Still stuck?{' '}
          <a
            href="https://joinworkwise.com/contact"
            className="font-medium text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-300"
          >
            Get in touch
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
