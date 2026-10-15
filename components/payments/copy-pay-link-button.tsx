'use client';

import { useState } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getPayLink } from '@/lib/actions/payments';
import { Button } from '@/components/ui/button';

/** Copies the customer's pay link. `iconOnly` is the small round version used in tight rows. */
export async function copyPayLink(customerId: string): Promise<void> {
  const result = await getPayLink(customerId);
  if (!result.success) {
    toast.error(result.error);
    return;
  }
  try {
    await navigator.clipboard.writeText(result.url);
    toast.success('Pay link copied');
  } catch {
    toast.error('Could not copy the pay link');
  }
}

export function CopyPayLinkButton({
  customerId,
  available,
  iconOnly = false,
}: {
  customerId: string;
  available: boolean;
  iconOnly?: boolean;
}) {
  const [pending, setPending] = useState(false);

  const handle = async () => {
    setPending(true);
    await copyPayLink(customerId);
    setPending(false);
  };

  if (iconOnly) {
    return (
      <Button
        variant="outline"
        size="icon"
        className="size-9 sm:size-8"
        onClick={() => void handle()}
        disabled={!available || pending}
        aria-label="Copy pay link"
        title="Copy pay link"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void handle()} disabled={!available || pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      Copy pay link
    </Button>
  );
}
