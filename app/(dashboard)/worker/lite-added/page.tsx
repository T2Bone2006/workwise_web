'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { hasLiteNowAction } from '@/lib/actions/billing';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Where Stripe sends them back after paying: wait for the webhook to switch Lite on, then start the set-up. */
export default function WorkerLiteAddedPage() {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const deadline = Date.now() + 20_000;
      while (!cancelled && Date.now() < deadline) {
        try {
          if (await hasLiteNowAction()) {
            floatingMessage({ title: "Lite added. Let's teach it how you price." });
            router.push('/lite/setup');
            return;
          }
        } catch {
          /* try again until the time is up */
        }
        await sleep(1500);
      }
      if (!cancelled) setSlow(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      {slow ? (
        <>
          <p className="text-lg font-semibold">Lite is on its way</p>
          <p className="text-sm text-muted-foreground">It can take a minute after you pay.</p>
          <Button asChild variant="outline">
            <Link href="/lite/setup">Go to Lite</Link>
          </Button>
        </>
      ) : (
        <>
          <Loader2 className="size-7 animate-spin text-(--tone-lite-text)" aria-hidden />
          <p className="text-lg font-semibold">Turning on Lite…</p>
          <p className="text-sm text-muted-foreground">This only takes a moment.</p>
        </>
      )}
    </div>
  );
}
