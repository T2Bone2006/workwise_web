'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setWidgetActiveAction } from '@/lib/actions/lite/widget';
import { litePaths } from '@/lib/navigation/lite-paths';
import { Globe } from 'lucide-react';
import { IconChip, Tag } from '@/components/look';
import { Button } from '@/components/ui/button';

export function StatusCard({
  active,
  website,
  setupLive,
  seenOnWebsite,
  last7Days,
}: {
  active: boolean;
  website: string | null;
  setupLive: boolean;
  seenOnWebsite: boolean;
  last7Days: { chats: number; leads: number };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paused = !active;

  async function save(nextActive: boolean) {
    setPending(true);
    setError(null);
    const result = await setWidgetActiveAction(nextActive);
    setPending(false);
    setConfirming(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  if (!setupLive) {
    return (
      <section className="border border-border bg-card shadow-(--look-card-shadow) space-y-2 rounded-2xl p-4 sm:p-5">
        <h2 className="text-base font-semibold">Finish setting up first</h2>
        <p className="text-sm text-muted-foreground">The chat is not on a website until the interview is done and the code is pasted.</p>
        <Link href={litePaths.setup} className="inline-block text-sm font-semibold">
          Carry on
        </Link>
      </section>
    );
  }

  const codeLabel = !website ? 'No website saved' : seenOnWebsite ? `Seen on ${website}` : 'Not detected';

  return (
    <section className="border border-border bg-card shadow-(--look-card-shadow) space-y-4 rounded-2xl p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <IconChip icon={Globe} tone={paused ? 'slate' : seenOnWebsite ? 'emerald' : 'amber'} />
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            Your website chat
            {paused ? (
              <Tag tone="slate">Off</Tag>
            ) : seenOnWebsite ? (
              <Tag tone="emerald">On</Tag>
            ) : (
              <Tag tone="amber">On, waiting for the code</Tag>
            )}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {paused
              ? 'Paused. Add or switch it back on to let it appear.'
              : website
                ? seenOnWebsite
                  ? `Live on ${website}.`
                  : `Switched on for ${website}, but nothing from that site has opened it yet.`
                : 'Add your website to switch it on.'}
          </p>
        </div>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">
          Saving a website does not put the chat on it. The code has to be pasted on that site, and then someone has to open the chat.
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-muted/50 p-3">
          <dt className="text-xs font-medium text-muted-foreground">Assistant</dt>
          <dd className="mt-1"><Tag tone={paused ? 'slate' : 'emerald'}>{paused ? 'Paused' : 'Switched on'}</Tag></dd>
          <p className="mt-1 text-xs text-muted-foreground">
            {paused
              ? 'The bubble stays hidden until you switch it back on.'
              : 'On means it is allowed to appear. It still has to be pasted on the site.'}
          </p>
        </div>
        <div className="rounded-xl bg-muted/50 p-3">
          <dt className="text-xs font-medium text-muted-foreground">Allowed on</dt>
          <dd className="mt-1 break-all text-sm font-semibold">{website ?? 'No website yet'}</dd>
          <p className="mt-1 text-xs text-muted-foreground">The only address the chat will answer on. Change it below if this is not your site.</p>
        </div>
        <div className="rounded-xl bg-muted/50 p-3">
          <dt className="text-xs font-medium text-muted-foreground">Code on that site</dt>
          <dd className="mt-1">
            <Tag tone={seenOnWebsite ? 'emerald' : 'amber'}>{codeLabel}</Tag>
          </dd>
          <p className="mt-1 text-xs text-muted-foreground">
            {seenOnWebsite
              ? 'Someone opened the chat there in the last 7 days.'
              : 'Nothing from that site has opened the chat in the last 7 days.'}
          </p>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        Last 7 days: {last7Days.chats} chats, {last7Days.leads} left their details
      </p>
      {confirming ? (
        <div className="space-y-3 rounded-xl bg-muted/50 p-3">
          <p className="text-sm">Your website won&apos;t show the chat until you switch it back on.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={() => void save(false)}>
              Pause the assistant
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant={paused ? 'default' : 'outline'}
          disabled={pending}
          onClick={() => {
            if (paused) void save(true);
            else setConfirming(true);
          }}
        >
          {paused ? 'Switch the assistant back on' : 'Pause the assistant'}
        </Button>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
