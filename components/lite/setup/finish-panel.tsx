'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { startInterviewAction } from '@/lib/actions/lite/interview';
import { CopySnippet } from '@/components/lite/copy-snippet';
import { WidgetPreview } from '@/components/lite/widget-preview';
import { Button } from '@/components/ui/button';
import { litePaths } from '@/lib/navigation/lite-paths';

export function FinishPanel({
  businessName,
  snippet,
  greeting,
  primaryColour,
  starterPrompts,
}: {
  businessName: string;
  snippet: string;
  greeting: string;
  primaryColour: string;
  starterPrompts: string[];
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subject = encodeURIComponent(`Website chat code for ${businessName}`);
  const body = encodeURIComponent(`${snippet}\n\nPaste this just before </body> on every page.`);

  async function redo() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await startInterviewAction(true);
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-col items-start gap-3">
        <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          <Check className="size-7" />
        </span>
        <h2 className="text-xl font-semibold">Your website chat is ready</h2>
      </div>

      <section className="glass-card min-w-0 space-y-3 rounded-xl p-4">
        <h3 className="flex items-center gap-3 text-sm font-medium">
          <span className="flex size-7 items-center justify-center rounded-full bg-(--tone-lite-soft) text-sm font-semibold text-(--tone-lite-text)">
            1
          </span>
          Give this to your web person
        </h3>
        <CopySnippet snippet={snippet} />
        <p className="text-xs text-muted-foreground">Paste this just before &lt;/body&gt; on every page. Send this line to whoever looks after your website.</p>
        <Button variant="outline" asChild>
          <a href={`mailto:?subject=${subject}&body=${body}`}>Email it</a>
        </Button>
      </section>

      <section className="glass-card min-w-0 space-y-3 rounded-xl p-4">
        <h3 className="flex items-center gap-3 text-sm font-medium">
          <span className="flex size-7 items-center justify-center rounded-full bg-(--tone-lite-soft) text-sm font-semibold text-(--tone-lite-text)">
            2
          </span>
          Try it
        </h3>
        <WidgetPreview
          source="live"
          businessName={businessName}
          greeting={greeting}
          primaryColour={primaryColour}
          starterPrompts={starterPrompts}
        />
      </section>

      <section className="glass-card min-w-0 space-y-3 rounded-xl p-4">
        <h3 className="flex items-center gap-3 text-sm font-medium">
          <span className="flex size-7 items-center justify-center rounded-full bg-(--tone-lite-soft) text-sm font-semibold text-(--tone-lite-text)">
            3
          </span>
          What happens next
        </h3>
        <p className="text-sm">
          When a customer leaves their details you&apos;ll get an email straight away. Go to Leads to see them.
        </p>
        <Button asChild>
          <Link href={litePaths.leads}>Go to Leads</Link>
        </Button>
      </section>

      <div className="space-y-2">
        {confirming ? (
          <div className="space-y-2 rounded-xl border border-border p-3">
            <p className="text-sm">
              Your website chat keeps your current answers until you finish the new interview.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending} onClick={() => void redo()}>
                {pending ? 'Starting…' : 'Start the new interview'}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setConfirming(true)}>
            Redo the interview
          </button>
        )}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
