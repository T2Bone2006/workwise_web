'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveWidgetWebsiteAction } from '@/lib/actions/lite/widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function WebsiteForm({ website }: { website: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(website ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    const result = await saveWidgetWebsiteAction(value);
    setPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <section className="border border-border bg-card shadow-(--look-card-shadow) space-y-3 rounded-2xl p-4 sm:p-5">
      <h2 className="text-base font-semibold">2. The site it is allowed on</h2>
      <p className="text-sm text-muted-foreground">
        This is not where the chat has been installed. It is the only address that is allowed to use the code. If this is not your site, change it.
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="block text-sm font-medium" htmlFor="widget-website">
          Website
          <Input
            id="widget-website"
            className="mt-1"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="daveplastering.co.uk"
            autoComplete="url"
          />
        </label>
        <p className="text-sm text-muted-foreground">www. is included. Saving this does not add the chat to the site.</p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
      </form>
    </section>
  );
}
