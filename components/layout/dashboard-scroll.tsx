'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

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
      className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6"
    >
      {children}
    </main>
  );
}
