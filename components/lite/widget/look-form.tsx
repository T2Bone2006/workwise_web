'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveWidgetLookAction } from '@/lib/actions/lite/widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const SWATCHES = ['#0C66E4', '#0F766E', '#15803D', '#CA8A04', '#C2410C', '#BE123C', '#6D28D9', '#0F172A'];

function safeColour(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#0C66E4';
}

export function LookForm({ primaryColour, greeting }: { primaryColour: string; greeting: string }) {
  const router = useRouter();
  const [colour, setColour] = useState(primaryColour);
  const [hello, setHello] = useState(greeting);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = safeColour(colour);

  async function save() {
    setPending(true);
    setError(null);
    const result = await saveWidgetLookAction({ primaryColour: colour, greeting: hello });
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <section className="border border-border bg-card shadow-(--look-card-shadow) space-y-3 rounded-2xl p-4 sm:p-5">
      <h2 className="text-base font-semibold">How the bubble looks</h2>
      <p className="text-sm text-muted-foreground">Colour and the first line a visitor sees. This does not put the chat on your site.</p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-wrap gap-2">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={swatch}
              className={cn('size-8 rounded-full ring-offset-2 ring-offset-background', colour.toLowerCase() === swatch.toLowerCase() && 'ring-2 ring-foreground')}
              style={{ backgroundColor: swatch }}
              onClick={() => setColour(swatch)}
            />
          ))}
        </div>
        <label className="block text-sm font-medium" htmlFor="widget-colour">
          Colour
          <Input id="widget-colour" className="mt-1 font-mono" value={colour} onChange={(event) => setColour(event.target.value)} />
        </label>
        <label className="block text-sm font-medium" htmlFor="widget-greeting">
          Greeting
          <Textarea
            id="widget-greeting"
            className="mt-1"
            value={hello}
            maxLength={200}
            rows={3}
            onChange={(event) => setHello(event.target.value)}
          />
        </label>
        <p className="text-xs text-muted-foreground tabular-nums">{hello.trim().length}/200</p>
        <div className="flex items-end gap-2">
          <span className="size-10 shrink-0 rounded-full" style={{ backgroundColor: shown }} aria-hidden />
          <p className="max-w-sm rounded-2xl px-3 py-2 text-sm text-white" style={{ backgroundColor: shown }}>
            {hello.trim() || 'Greeting'}
          </p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
      </form>
    </section>
  );
}
