'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { BreadcrumbNamesProvider } from '@/components/layout/page-breadcrumb';
import { useLook } from '@/components/look/use-look';
import { cn } from '@/lib/utils';

const positions = new Map<string, number>();

function locationKey(pathname: string): string {
  return pathname + window.location.search;
}

function scrollToWhenReady(main: HTMLElement, top: number) {
  let frames = 0;
  const apply = () => {
    main.scrollTo(0, top);
    frames += 1;
    const room = main.scrollHeight - main.clientHeight;
    if (top > 0 && room + 1 < top && frames < 12) {
      requestAnimationFrame(apply);
    }
  };
  apply();
}

export function DashboardScroll({ children }: { children: React.ReactNode }) {
  const look = useLook();
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);
  const popped = useRef(false);
  const keyRef = useRef('');

  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const onPop = () => {
      popped.current = true;
    };
    window.addEventListener('popstate', onPop);
    return () => {
      history.scrollRestoration = previous;
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onScroll = () => {
      if (!keyRef.current) return;
      positions.set(keyRef.current, main.scrollTop);
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const key = locationKey(pathname);
    const restore = popped.current;
    popped.current = false;
    keyRef.current = key;
    scrollToWhenReady(main, restore ? (positions.get(key) ?? 0) : 0);
  }, [pathname]);

  return (
    <main
      ref={mainRef}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain',
        look === 'new' ? 'px-4 py-5 sm:px-8 sm:py-7' : 'p-4 sm:p-6',
      )}
    >
      <BreadcrumbNamesProvider>
        {look === 'new' ? (
          <div className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col">{children}</div>
        ) : (
          children
        )}
      </BreadcrumbNamesProvider>
    </main>
  );
}
